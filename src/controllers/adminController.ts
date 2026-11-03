import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../server';
import { templateService } from '../services/templateService';
import {
  sendShortlistEmail,
  sendRejectionEmail,
  sendAnnouncementEmail,
  sendInterviewReminderEmail
} from '../services/emailService';
import { calculateAtsScore } from '../utils/atsCalculator';
import { resolveCandidateName } from '../utils/candidateNameHelper';
import { permanentlyDeleteUser } from '../services/userDeletionService';
import { getCandidateExtendedDetails } from '../utils/candidateProfileStore';

export const getUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      }
    });
    const formatted = users.map(u => ({
      ...u,
      name: u.role === 'CANDIDATE' ? resolveCandidateName(u) : u.name,
      joined: new Date(u.createdAt).toLocaleDateString(),
      lastActive: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'
    }));
    return res.status(200).json(formatted);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching users' });
  }
};

export const getCandidates = async (req: Request, res: Response) => {
  try {
    // Auto-create CandidateProfile for any registered CANDIDATE user who doesn't have one
    const candUsersWithoutProfile = await prisma.user.findMany({
      where: {
        role: 'CANDIDATE',
        candidateProfile: null
      }
    });
    for (const u of candUsersWithoutProfile) {
      await prisma.candidateProfile.create({
        data: {
          userId: u.id,
          location: 'Chennai, India',
          workMode: 'Hybrid / Remote',
          noticePeriod: '15 Days',
          expectedSalary: '₹8,50,000 - ₹14,00,000 PA'
        }
      }).catch(() => {});
    }

    const candidates = await prisma.candidateProfile.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true }
        },
        skills: true,
        resumes: { select: { id: true, fileUrl: true, fileName: true }, orderBy: { createdAt: 'desc' } },
        _count: {
          select: { applications: true }
        }
      },
      orderBy: { user: { createdAt: 'desc' } }
    });
    const formatted = candidates.map(c => {
      const candSkills = c.skills.map(s => s.name);
      const extDetails = getCandidateExtendedDetails(c.user, candSkills, c.noticePeriod || undefined);
      const rawResume = c.resumes[0];
      let resumeUrl: string | null = null;
      let resumeFileName: string | null = null;
      let hasResume = false;

      if (rawResume?.fileUrl || rawResume?.fileName) {
        hasResume = true;
        resumeFileName = rawResume.fileName ? decodeURIComponent(rawResume.fileName).replace(/%20/g, ' ') : 'Resume.pdf';
        const fileUrlStr = String(rawResume.fileUrl || '');
        if (fileUrlStr.startsWith('/api/resumes/') || (fileUrlStr.startsWith('http') && !fileUrlStr.includes('storage.jobbuffer.in'))) {
          resumeUrl = fileUrlStr;
        } else {
          const fn = fileUrlStr.split('/').pop() || resumeFileName;
          resumeUrl = `/api/resumes/${encodeURIComponent(fn)}`;
        }
      }

      return {
        id: c.id,
        userId: c.userId,
        name: resolveCandidateName(c.user, c.resumes),
        email: c.user.email,
        phone: c.user.phone || 'N/A',
        headline: extDetails.headline || (candSkills.length > 0 ? `${candSkills[0]} Specialist` : (c.workMode ? `${c.workMode} Professional` : 'Candidate')),
        location: c.location || 'Not Specified',
        workMode: c.workMode || 'Not Specified',
        noticePeriod: c.noticePeriod || 'Not Specified',
        expectedSalary: c.expectedSalary || 'Negotiable',
        experience: extDetails.experienceList?.[0] ? `${extDetails.experienceList[0].role} (${extDetails.experienceList[0].duration})` : (c.noticePeriod ? `Notice: ${c.noticePeriod}` : 'Not Specified'),
        bio: extDetails.bio || '',
        education: extDetails.education || [],
        experienceList: extDetails.experienceList || [],
        certifications: extDetails.certifications || [],
        projects: extDetails.projects || [],
        languages: extDetails.languages || ['English', 'Tamil'],
        links: extDetails.links || {},
        skills: candSkills,
        status: c.user.status,
        hasResume,
        resumeUrl,
        resumeFileName,
        applications: c._count.applications
      };
    });
    return res.status(200).json(formatted);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching candidates' });
  }
};

export const getRecruiters = async (req: Request, res: Response) => {
  try {
    const recruiters = await prisma.recruiterProfile.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true, lastLoginAt: true } },
        company: true,
        jobs: {
          select: {
            id: true,
            title: true,
            status: true,
            location: true,
            jobType: true,
            createdAt: true,
            _count: { select: { applications: true } }
          },
          orderBy: { createdAt: 'desc' }
        },
        _count: { select: { jobs: true } }
      },
      orderBy: { user: { createdAt: 'desc' } }
    });
    const formatted = recruiters.map(r => ({
      id: r.id,
      userId: r.user.id,
      name: r.user.name,
      company: r.company?.name || 'Direct Recruiter',
      companyId: r.companyId,
      email: r.user.email,
      phone: r.user.phone || 'N/A',
      designation: r.designation || 'Hiring Manager',
      status: r.user.status,
      applied: new Date(r.user.createdAt).toLocaleDateString(),
      createdAt: r.user.createdAt,
      lastLoginAt: r.user.lastLoginAt,
      jobsPosted: r._count.jobs,
      jobs: r.jobs.map(j => ({
        id: j.id,
        title: j.title,
        status: j.status,
        location: j.location,
        type: j.jobType,
        applications: j._count.applications,
        created: new Date(j.createdAt).toLocaleDateString()
      })),
      companyDetails: r.company ? {
        name: r.company.name,
        website: r.company.website,
        industry: r.company.industry,
        size: r.company.size,
        headquarters: r.company.headquarters,
        description: r.company.description
      } : null
    }));
    return res.status(200).json(formatted);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching recruiters' });
  }
};

export const adminResetRecruiterPassword = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id); // Can be recruiterProfile ID or user ID
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { id },
          { recruiterProfile: { id } }
        ]
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'Recruiter account not found' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, updatedAt: new Date() }
    });

    console.log(`[ADMIN ACTION] Admin updated password for recruiter ${user.name} (${user.email})`);

    return res.status(200).json({
      message: `Password for ${user.name} (${user.email}) has been successfully updated by Admin.`
    });
  } catch (error: any) {
    console.error('Error resetting recruiter password by admin:', error);
    return res.status(500).json({ message: 'Error resetting password', error: error?.message });
  }
};

export const getCompanies = async (req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        _count: { select: { jobs: true, recruiters: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    const formatted = companies.map(c => ({
      id: c.id,
      name: c.name,
      industry: c.industry || 'Not Specified',
      employees: c.size || 'Not Specified',
      location: c.headquarters || 'Not Specified',
      status: 'VERIFIED',
      jobsCount: c._count.jobs,
      recruitersCount: c._count.recruiters
    }));
    return res.status(200).json(formatted);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching companies' });
  }
};

export const getAdminJobs = async (req: Request, res: Response) => {
  try {
    const jobs = await prisma.job.findMany({
      include: {
        company: { select: { id: true, name: true } },
        recruiter: { include: { user: { select: { name: true, email: true } } } },
        _count: {
          select: { applications: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const formatted = jobs.map(j => ({
      id: j.id,
      title: j.title,
      company: j.company.name,
      recruiter: j.recruiter?.user?.name || 'Recruiter',
      location: j.location || 'Remote',
      jobType: j.jobType || 'Full-time',
      status: j.status,
      applications: j._count.applications,
      reports: 0,
      createdAt: j.createdAt
    }));
    return res.status(200).json(formatted);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching admin jobs' });
  }
};

export const getAdminApplications = async (req: Request, res: Response) => {
  try {
    const applications = await prisma.application.findMany({
      include: {
        job: {
          select: {
            id: true,
            title: true,
            jobType: true,
            workMode: true,
            location: true,
            requirements: true,
            description: true,
            category: { select: { id: true, name: true } },
            skills: { include: { skill: true } },
            company: { select: { id: true, name: true, logo: true } }
          }
        },
        candidate: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true } },
            skills: { select: { id: true, name: true } },
            resumes: { select: { id: true, fileName: true, fileUrl: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = applications.map(app => {
      const candSkills = app.candidate.skills.map(s => s.name);
      const jobSkills = (app.job as any).skills && (app.job as any).skills.length > 0
        ? (app.job as any).skills.map((js: any) => js.skill?.name).filter(Boolean)
        : [];

      const atsScore = calculateAtsScore(
        candSkills,
        jobSkills,
        app.job.title,
        (app.job as any).requirements,
        (app.job as any).description
      );

      const extDetails = getCandidateExtendedDetails(app.candidate.user, candSkills);
      const rawResume = app.candidate.resumes[0];
      let resumeUrl: string | null = null;
      let resumeFileName: string | null = null;
      let hasResume = false;

      if (rawResume?.fileUrl || rawResume?.fileName) {
        hasResume = true;
        resumeFileName = rawResume.fileName ? decodeURIComponent(rawResume.fileName).replace(/%20/g, ' ') : 'Resume.pdf';
        const fileUrlStr = String(rawResume.fileUrl || '');
        if (fileUrlStr.startsWith('/api/resumes/') || (fileUrlStr.startsWith('http') && !fileUrlStr.includes('storage.jobbuffer.in'))) {
          resumeUrl = fileUrlStr;
        } else {
          const fn = fileUrlStr.split('/').pop() || resumeFileName;
          resumeUrl = `/api/resumes/${encodeURIComponent(fn)}`;
        }
      }

      return {
        id: app.id,
        candidateId: app.candidate.id,
        candidateName: resolveCandidateName(app.candidate.user, app.candidate.resumes),
        candidateEmail: app.candidate.user.email,
        candidatePhone: app.candidate.user.phone || 'N/A',
        location: app.candidate.location || app.job.location || 'Not Specified',
        skills: candSkills,
        education: extDetails.education || [],
        experienceList: extDetails.experienceList || [],
        bio: extDetails.bio || '',
        certifications: extDetails.certifications || [],
        projects: extDetails.projects || [],
        languages: extDetails.languages || ['English', 'Tamil'],
        links: extDetails.links || {},
        jobId: app.job.id,
        jobTitle: app.job.title,
        jobCategory: (app.job as any).category?.name || 'Development',
        jobType: app.job.jobType || 'Full-time',
        companyId: app.job.company.id,
        companyName: app.job.company.name,
        status: app.status,
        resumeUrl,
        resumeFileName,
        hasResume,
        atsScore,
        appliedAt: app.createdAt,
        updatedAt: app.updatedAt
      };
    });

    return res.status(200).json(formatted);
  } catch (error) {
    console.error('Error fetching admin applications:', error);
    return res.status(500).json({ message: 'Error fetching applications' });
  }
};

export const updateApplicationStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updated = await prisma.application.update({
      where: { id: String(id) },
      data: { status: status as any },
      include: {
        job: { select: { title: true, company: { select: { name: true } } } },
        candidate: { select: { user: { select: { id: true, name: true, email: true } } } }
      }
    });

    // Automated Notification & Email Triggers for candidate
    try {
      const candidateUser = updated.candidate?.user;
      if (candidateUser) {
        const jobTitle = updated.job?.title || 'Open Role';
        const companyName = updated.job?.company?.name || 'Recruiter Company';

        let notifTitle = `Application Status: ${status}`;
        let notifMessage = `Your application for "${jobTitle}" has been updated to ${status}.`;

        if (status === 'SHORTLISTED') {
          notifTitle = '🎉 You are Shortlisted!';
          notifMessage = `Congratulations! You have been shortlisted for "${jobTitle}" at ${companyName}.`;
        } else if (status === 'REJECTED') {
          notifTitle = 'Application Status Update';
          notifMessage = `Thank you for your interest in "${jobTitle}" at ${companyName}. The hiring team has updated your application status.`;
        }

        await (prisma as any).notification.create({
          data: {
            userId: candidateUser.id,
            title: notifTitle,
            message: notifMessage,
            type: status,
            link: '/(tabs)/applications'
          }
        });

        if (status === 'SHORTLISTED' && candidateUser.email) {
          sendShortlistEmail(candidateUser.email, candidateUser.name, jobTitle, companyName).catch(e =>
            console.warn('[EMAIL] Shortlist delivery notice:', e.message)
          );
        } else if (status === 'REJECTED' && candidateUser.email) {
          sendRejectionEmail(candidateUser.email, candidateUser.name, jobTitle, companyName).catch(e =>
            console.warn('[EMAIL] Rejection delivery notice:', e.message)
          );
        }
      }
    } catch (triggerErr: any) {
      console.warn('Status automation trigger notice:', triggerErr?.message);
    }

    return res.status(200).json({
      message: 'Application status updated successfully',
      application: updated
    });
  } catch (error) {
    console.error('Error updating application status:', error);
    return res.status(500).json({ message: 'Error updating application status' });
  }
};

export const getNotifications = async (req: Request, res: Response) => {
  try {
    const notifications = await (prisma as any).notification.findMany({
      include: {
        user: { select: { name: true, email: true, role: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const auditLogs = await prisma.adminAuditLog.findMany({
      include: { user: { select: { name: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    const formattedAudit = auditLogs.map((log: any) => ({
      id: log.id,
      title: `${log.action} on ${log.entity}`,
      message: `User ${log.user.name} (${log.user.email}) performed ${log.action} on ${log.entity}. ${log.metadata ? log.metadata : ''}`,
      date: log.createdAt,
      type: 'AUDIT',
      read: false,
      userRole: log.user.role,
      userName: log.user.name
    }));

    const formattedNotifs = notifications.map((notif: any) => ({
      id: notif.id,
      title: notif.title,
      message: notif.message,
      date: notif.createdAt,
      type: notif.type,
      read: notif.read,
      link: notif.link,
      userRole: notif.user?.role || 'SYSTEM',
      userName: notif.user?.name || 'System'
    }));

    const combined = [...formattedNotifs, ...formattedAudit].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return res.status(200).json(combined);
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    return res.status(500).json({ message: 'Error fetching notifications', error: error?.message || String(error) });
  }
};

export const markNotificationAsRead = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await (prisma as any).notification.updateMany({
      where: { id: String(id) },
      data: { read: true }
    });
    return res.status(200).json({ message: 'Notification marked as read' });
  } catch (error) {
    return res.status(500).json({ message: 'Error updating notification' });
  }
};

export const markAllNotificationsAsRead = async (req: Request, res: Response) => {
  try {
    await (prisma as any).notification.updateMany({
      data: { read: true }
    });
    return res.status(200).json({ message: 'All notifications marked as read' });
  } catch (error) {
    return res.status(500).json({ message: 'Error marking notifications' });
  }
};

export const sendBroadcastNotification = async (req: Request, res: Response) => {
  try {
    const { title, message, targetRole, type, link } = req.body;
    if (!title || !message) {
      return res.status(400).json({ message: 'Title and message are required' });
    }

    const userWhere: any = {};
    if (targetRole && targetRole !== 'ALL') {
      userWhere.role = targetRole;
    }

    const targetUsers = await prisma.user.findMany({
      where: userWhere,
      select: { id: true }
    });

    if (targetUsers.length === 0) {
      return res.status(404).json({ message: 'No target users found for this role' });
    }

    const notificationsData = targetUsers.map((u) => ({
      userId: u.id,
      title,
      message,
      type: type || 'SYSTEM',
      link: link || null,
      read: false
    }));

    await (prisma as any).notification.createMany({
      data: notificationsData
    });

    await prisma.adminAuditLog.create({
      data: {
        userId: (req as any).user?.id || targetUsers[0].id,
        action: 'BROADCAST_SENT',
        entity: 'NOTIFICATION',
        metadata: JSON.stringify({ title, targetRole: targetRole || 'ALL', count: targetUsers.length })
      }
    });

    return res.status(200).json({
      message: `Broadcast successfully dispatched to ${targetUsers.length} user(s)`,
      sentCount: targetUsers.length
    });
  } catch (error: any) {
    console.error('Error sending broadcast:', error);
    return res.status(500).json({ message: 'Error sending broadcast notification', error: error?.message });
  }
};

export const getReports = async (req: Request, res: Response) => {
  try {
    const usersByRole = await prisma.user.groupBy({ by: ['role'], _count: true });
    const jobsByStatus = await prisma.job.groupBy({ by: ['status'], _count: true });
    const applicationsByStatus = await prisma.application.groupBy({ by: ['status'], _count: true });
    const totalCompanies = await prisma.company.count();
    const totalInterviews = await (prisma as any).interview.count();

    return res.status(200).json({
      users: usersByRole,
      jobs: jobsByStatus,
      applications: applicationsByStatus,
      totalCompanies,
      totalInterviews
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching reports' });
  }
};

export const getCategories = async (req: Request, res: Response) => {
  try {
    const categories = await prisma.jobCategory.findMany({
      include: {
        _count: { select: { jobs: true } }
      }
    });
    return res.status(200).json(categories);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching categories' });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Category name is required' });
    }
    const cat = await prisma.jobCategory.upsert({
      where: { name: name.trim() },
      update: {},
      create: { name: name.trim() }
    });
    return res.status(201).json(cat);
  } catch (error) {
    console.error('Error creating category:', error);
    return res.status(500).json({ message: 'Error creating category' });
  }
};

export const getSkills = async (req: Request, res: Response) => {
  try {
    const skills = await prisma.skill.findMany({
      include: {
        _count: { select: { candidates: true, jobSkills: true } }
      }
    });
    return res.status(200).json(skills);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching skills' });
  }
};

export const getInterviews = async (req: Request, res: Response) => {
  try {
    const interviews = await (prisma as any).interview.findMany({
      include: {
        job: { select: { id: true, title: true, company: { select: { id: true, name: true } } } },
        candidate: { select: { id: true, location: true, user: { select: { name: true, email: true, phone: true } } } },
        recruiter: { select: { id: true, designation: true, user: { select: { name: true, email: true } }, company: { select: { name: true } } } }
      },
      orderBy: { scheduledAt: 'desc' }
    });

    const formatted = interviews.map((i: any) => ({
      id: i.id,
      title: i.title,
      type: i.type,
      status: i.status,
      scheduledAt: i.scheduledAt,
      durationMinutes: i.durationMinutes,
      meetingLink: i.meetingLink,
      location: i.location,
      notes: i.notes,
      feedback: i.feedback,
      candidateName: resolveCandidateName(i.candidate.user),
      candidateEmail: i.candidate.user.email,
      candidatePhone: i.candidate.user.phone || 'N/A',
      candidateLocation: i.candidate.location || 'Remote',
      jobTitle: i.job?.title || 'General Position',
      companyName: i.recruiter?.company?.name || i.job?.company?.name || 'Company',
      recruiterName: i.recruiter.user.name,
      recruiterEmail: i.recruiter.user.email
    }));

    return res.status(200).json(formatted);
  } catch (error: any) {
    console.error('Error fetching interviews:', error);
    return res.status(500).json({ message: 'Error fetching interviews', error: error?.message || String(error) });
  }
};

export const getModerationItems = async (req: Request, res: Response) => {
  try {
    const [jobs, companies, users] = await Promise.all([
      prisma.job.findMany({
        include: {
          company: { select: { id: true, name: true } },
          recruiter: { select: { user: { select: { name: true, email: true } } } },
          _count: { select: { applications: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.company.findMany({
        include: {
          _count: { select: { recruiters: true, jobs: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    const formattedJobs = jobs.map(j => ({
      id: j.id,
      type: 'JOB',
      title: j.title,
      subtitle: `${j.company.name} • Posted by ${j.recruiter.user.name}`,
      status: j.status,
      riskLevel: j.status === 'REJECTED' || j.status === 'CLOSED' ? 'FLAGGED' : j.status === 'DRAFT' || j.status === 'PENDING_REVIEW' ? 'PENDING' : 'APPROVED',
      details: {
        jobType: j.jobType || 'Full-time',
        location: j.location || 'Remote',
        applications: j._count.applications,
        company: j.company.name,
        creator: j.recruiter.user.email
      },
      createdAt: j.createdAt
    }));

    const formattedCompanies = companies.map(c => ({
      id: c.id,
      type: 'COMPANY',
      title: c.name,
      subtitle: `${c.industry || 'General'} • ${c.headquarters || 'Not Specified'}`,
      status: 'VERIFIED',
      riskLevel: 'APPROVED',
      details: {
        size: c.size || 'Not Specified',
        recruitersCount: c._count.recruiters,
        jobsCount: c._count.jobs,
        website: c.website || 'N/A'
      },
      createdAt: c.createdAt
    }));

    const formattedUsers = users.map(u => ({
      id: u.id,
      type: 'USER',
      title: u.name,
      subtitle: `${u.role} • ${u.email}`,
      status: u.status,
      riskLevel: u.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      details: {
        role: u.role,
        email: u.email,
        status: u.status,
        lastLoginAt: u.lastLoginAt
      },
      createdAt: u.createdAt
    }));

    return res.status(200).json({
      jobs: formattedJobs,
      companies: formattedCompanies,
      users: formattedUsers,
      totalPending: formattedJobs.filter(j => j.status === 'DRAFT' || j.status === 'PENDING_REVIEW').length
    });
  } catch (error) {
    console.error('Error fetching moderation items:', error);
    return res.status(500).json({ message: 'Error fetching moderation items' });
  }
};

export const handleModerationAction = async (req: Request, res: Response) => {
  try {
    const { entityType, entityId, action } = req.body;

    if (entityType === 'JOB') {
      if (action === 'APPROVE') {
        await prisma.job.update({ where: { id: String(entityId) }, data: { status: 'PUBLISHED' } });
      } else if (action === 'FLAG' || action === 'SUSPEND') {
        await prisma.job.update({ where: { id: String(entityId) }, data: { status: 'REJECTED' } });
      }
    } else if (entityType === 'USER') {
      if (action === 'SUSPEND') {
        await prisma.user.update({ where: { id: String(entityId) }, data: { status: 'SUSPENDED' } });
      } else if (action === 'APPROVE') {
        await prisma.user.update({ where: { id: String(entityId) }, data: { status: 'ACTIVE' } });
      }
    }

    return res.status(200).json({ message: `Action ${action} executed successfully on ${entityType}` });
  } catch (error) {
    console.error('Error handling moderation action:', error);
    return res.status(500).json({ message: 'Error updating moderation item' });
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;
    const updated = await prisma.user.update({
      where: { id },
      data: { status }
    });
    return res.status(200).json({ message: `User status updated to ${status}`, user: updated });
  } catch (error) {
    console.error('Error updating user status:', error);
    return res.status(500).json({ message: 'Error updating user status' });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const result = await permanentlyDeleteUser(id);
    if (!result.success) {
      return res.status(404).json({ message: result.message });
    }
    return res.status(200).json({ message: result.message });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ message: 'Error deleting user', error: error?.message });
  }
};

export const updateAdminJobStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;
    const updated = await prisma.job.update({
      where: { id },
      data: { status }
    });
    return res.status(200).json({ message: `Job status updated to ${status}`, job: updated });
  } catch (error) {
    console.error('Error updating job status:', error);
    return res.status(500).json({ message: 'Error updating job status' });
  }
};

// ==========================================
// EMAIL TEMPLATES & AUTOMATION CONTROLLERS
// ==========================================

export const getEmailTemplates = async (req: Request, res: Response) => {
  try {
    const templates = templateService.getAllTemplates();
    return res.status(200).json(templates);
  } catch (error: any) {
    return res.status(500).json({ message: 'Error fetching email templates', error: error?.message });
  }
};

export const getEmailTemplateByCode = async (req: Request, res: Response) => {
  try {
    const code = req.params.code as string;
    const template = templateService.getTemplate(code);
    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }
    return res.status(200).json(template);
  } catch (error: any) {
    return res.status(500).json({ message: 'Error fetching template', error: error?.message });
  }
};

export const updateEmailTemplate = async (req: Request, res: Response) => {
  try {
    const code = req.params.code as string;
    const { name, subject, body, language, customReplyTo, replyTo, category } = req.body;

    const updated = templateService.updateTemplate(code, {
      name,
      subject,
      body,
      language,
      customReplyTo: Boolean(customReplyTo),
      replyTo,
      category
    });

    return res.status(200).json({
      message: 'Email template updated successfully',
      template: updated
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Error updating email template', error: error?.message });
  }
};

export const testSendEmailTemplate = async (req: Request, res: Response) => {
  try {
    const { code, targetEmail, customSubject, customBody, customReplyTo } = req.body;
    if (!targetEmail) {
      return res.status(400).json({ message: 'Recipient target email is required' });
    }

    const previewVars = {
      candidate_name: 'Alex Mercer',
      job_title: 'Senior Full Stack Engineer',
      company_name: 'Tech Innovations Ltd',
      interview_url: 'https://meet.google.com/jobuffer-demo',
      interview_date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }),
      interview_time: '10:30 AM IST',
      user_first_name: 'Sarah',
      user_last_name: 'Jenkins',
      otp_code: '8492',
      action_url: `${process.env.FRONTEND_URL || 'https://jobuffer.com'}/login`
    };

    let subject = customSubject;
    let body = customBody;

    if (!subject || !body) {
      const rendered = templateService.render(code || 'ANNOUNCEMENT', previewVars);
      subject = subject || rendered.subject;
      body = body || rendered.body;
    } else {
      for (const [k, v] of Object.entries(previewVars)) {
        subject = subject.split(`{${k}}`).join(v);
        body = body.split(`{${k}}`).join(v);
      }
    }

    const sendResult = await sendAnnouncementEmail(
      targetEmail,
      'Test Recipient',
      `[TEST] ${subject}`,
      body,
      customReplyTo
    );

    return res.status(200).json({
      message: sendResult.success ? `Test email sent successfully to ${targetEmail}` : 'Test email send attempted.',
      success: sendResult.success,
      error: sendResult.error
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Error sending test email', error: error?.message });
  }
};

export const getEmailDeliveryLogs = async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const search = req.query.search as string;
    const logs = templateService.getDeliveryLogs({ status, search });
    return res.status(200).json(logs);
  } catch (error: any) {
    return res.status(500).json({ message: 'Error fetching delivery logs', error: error?.message });
  }
};

export const deleteEmailDeliveryLog = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    templateService.deleteDeliveryLog(id);
    return res.status(200).json({ message: 'Delivery log deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Error deleting delivery log', error: error?.message });
  }
};

export const dispatchEmailAnnouncement = async (req: Request, res: Response) => {
  try {
    const { subject, body, targetRole, channel, customReplyTo } = req.body;
    if (!subject || !body) {
      return res.status(400).json({ message: 'Subject and body are required' });
    }

    const userWhere: any = {};
    if (targetRole && targetRole !== 'ALL') {
      userWhere.role = targetRole;
    }

    const users = await prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true, email: true }
    });

    if (users.length === 0) {
      return res.status(404).json({ message: 'No recipients found for this audience' });
    }

    const shouldSendEmail = channel === 'EMAIL' || channel === 'BOTH' || !channel;
    const shouldSendInApp = channel === 'IN_APP' || channel === 'BOTH' || !channel;

    // 1. In-App Notifications
    if (shouldSendInApp) {
      const notifs = users.map(u => ({
        userId: u.id,
        title: subject,
        message: body.substring(0, 200),
        type: 'SYSTEM',
        link: '/login'
      }));

      await (prisma as any).notification.createMany({
        data: notifs
      });
    }

    // 2. Email Dispatch (fire in batches)
    let emailDispatchedCount = 0;
    if (shouldSendEmail) {
      const topBatch = users.slice(0, 25);
      for (const u of topBatch) {
        if (u.email) {
          const personalizedBody = body
            .split('{candidate_name}').join(u.name)
            .split('{company_name}').join('JoBuffer')
            .split('{action_url}').join(`${process.env.FRONTEND_URL || 'https://jobuffer.com'}/login`);

          sendAnnouncementEmail(u.email, u.name, subject, personalizedBody, customReplyTo).catch(() => {});
          emailDispatchedCount++;
        }
      }
    }

    return res.status(200).json({
      message: `Announcement dispatched to ${users.length} users (${emailDispatchedCount} emails queued).`,
      recipientCount: users.length,
      emailDispatchedCount
    });
  } catch (error: any) {
    console.error('Error dispatching announcement:', error);
    return res.status(500).json({ message: 'Error dispatching announcement', error: error?.message });
  }
};

export const remindInterview = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const interview = await (prisma as any).interview.findUnique({
      where: { id: String(id) },
      include: {
        candidate: { include: { user: true } },
        job: { include: { company: true } },
        recruiter: { include: { user: true } }
      }
    });

    if (!interview) {
      return res.status(404).json({ message: 'Interview not found' });
    }

    const candidateUser = interview.candidate?.user;
    if (!candidateUser?.email) {
      return res.status(400).json({ message: 'Candidate email address not found' });
    }

    const jobTitle = interview.job?.title || interview.title;
    const companyName = interview.job?.company?.name || 'Hiring Team';
    const recruiterName = interview.recruiter?.user?.name || 'Recruiter';

    // 1. In-app notification
    await (prisma as any).notification.create({
      data: {
        userId: candidateUser.id,
        title: '⏰ Interview Reminder',
        message: `Reminder: You have an upcoming interview for "${jobTitle}" at ${companyName}.`,
        type: 'INTERVIEW',
        link: '/(tabs)/interviews'
      }
    });

    // 2. Email reminder
    const result = await sendInterviewReminderEmail(
      candidateUser.email,
      candidateUser.name,
      jobTitle,
      companyName,
      {
        scheduledAt: interview.scheduledAt,
        meetingLink: interview.meetingLink,
        recruiterName
      }
    );

    return res.status(200).json({
      message: `Interview reminder sent to ${candidateUser.name} (${candidateUser.email})`,
      delivered: result.success
    });
  } catch (error: any) {
    console.error('Error sending interview reminder:', error);
    return res.status(500).json({ message: 'Error sending interview reminder', error: error?.message });
  }
};

export const deleteCandidate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await permanentlyDeleteUser(String(id));
    if (!result.success) {
      return res.status(404).json({ message: result.message });
    }
    return res.status(200).json({ message: result.message });
  } catch (error: any) {
    console.error('Error deleting candidate:', error);
    return res.status(500).json({ message: 'Error deleting candidate', error: error?.message });
  }
};

export const deleteRecruiter = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await permanentlyDeleteUser(String(id));
    if (!result.success) {
      return res.status(404).json({ message: result.message });
    }
    return res.status(200).json({ message: result.message });
  } catch (error: any) {
    console.error('Error deleting recruiter:', error);
    return res.status(500).json({ message: 'Error deleting recruiter', error: error?.message });
  }
};

export const deleteApplication = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const app = await prisma.application.findUnique({
      where: { id: String(id) }
    });

    if (!app) {
      return res.status(404).json({ message: 'Application not found' });
    }

    await prisma.applicationStatusHistory.deleteMany({
      where: { applicationId: String(id) }
    });
    await prisma.application.delete({
      where: { id: String(id) }
    });

    console.log(`[ADMIN] Application ${id} deleted successfully`);
    return res.status(200).json({ message: 'Application deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting application:', error);
    return res.status(500).json({ message: 'Error deleting application', error: error?.message });
  }
};

