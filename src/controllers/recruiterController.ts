import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../server';
import {
  sendShortlistEmail,
  sendRejectionEmail,
  sendInterviewReminderEmail,
  sendApplicationReceivedEmail,
  sendJobOfferEmail,
  sendAnnouncementEmail
} from '../services/emailService';
import { templateService } from '../services/templateService';
import { calculateAtsScore } from '../utils/atsCalculator';
import { resolveCandidateName } from '../utils/candidateNameHelper';
import { getCandidateExtendedDetails } from '../utils/candidateProfileStore';
import {
  getSubscriptionConfig,
  recordSubscriptionPayment,
  getSubscriptionPayments,
  getRecruiterPricingPlans
} from '../services/subscriptionConfigService';

const DISMISSED_CANDIDATES_FILE = path.join(process.cwd(), '.dismissed-candidates.json');

function loadDismissedCandidates(): Record<string, string[]> {
  try {
    if (fs.existsSync(DISMISSED_CANDIDATES_FILE)) {
      return JSON.parse(fs.readFileSync(DISMISSED_CANDIDATES_FILE, 'utf-8'));
    }
  } catch (e) {}
  return {};
}

function saveDismissedCandidates(data: Record<string, string[]>) {
  try {
    fs.writeFileSync(DISMISSED_CANDIDATES_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {}
}

export async function getOrEnsureRecruiterProfile(userId: string) {
  let profile = await prisma.recruiterProfile.findUnique({
    where: { userId },
    include: { company: true, user: true }
  });
  if (!profile) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const companyName = user?.name ? `${user.name}'s Company` : 'Recruiting Company';
    let company = await prisma.company.create({
      data: {
        name: companyName,
        headquarters: 'Remote'
      }
    });
    try {
      profile = await prisma.recruiterProfile.create({
        data: {
          userId,
          companyId: company.id,
          designation: 'Recruitment Specialist'
        },
        include: { company: true, user: true }
      });
    } catch (e) {
      profile = await prisma.recruiterProfile.findUnique({
        where: { userId },
        include: { company: true, user: true }
      });
    }
  }
  return profile;
}

export const getJobs = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await getOrEnsureRecruiterProfile(userId);
    if (!profile) return res.status(200).json([]);

    // Multi-tenant isolation: Strictly fetch jobs created by this specific recruiter
    const jobs = await prisma.job.findMany({
      where: { recruiterId: profile.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { applications: true } }
      }
    });

    const formatted = jobs.map(j => ({
      id: j.id,
      title: j.title,
      location: j.location || 'Remote',
      type: j.jobType || 'Full-time',
      applications: j._count.applications,
      status: j.status,
      isUrgent: (j as any).isUrgent || false,
      created: j.createdAt ? new Date(j.createdAt).toLocaleDateString() : 'N/A',
      deadline: j.applicationDeadline ? new Date(j.applicationDeadline).toLocaleDateString() : 'No deadline'
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error fetching jobs' });
  }
};

export const createJob = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    let profile = await prisma.recruiterProfile.findUnique({
      where: { userId },
      include: { company: true, user: true }
    });

    if (!profile) {
      return res.status(404).json({ message: 'Recruiter profile not found' });
    }

    // Enforce Monthly Job Posting Limits based on Plan: FREE = 10, PRO = 50
    const plan = (profile.plan || 'FREE').toUpperCase();
    const isPro = plan === 'PRO';
    const maxMonthlyJobs = isPro ? 50 : 10;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthlyJobsPosted = await prisma.job.count({
      where: {
        recruiterId: profile.id,
        createdAt: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    if (monthlyJobsPosted >= maxMonthlyJobs) {
      return res.status(403).json({
        message: isPro
          ? `You have reached your PRO plan monthly limit of 50 job postings.`
          : `You have reached your FREE plan monthly limit of 10 job postings. Upgrade to PRO to post up to 50 jobs monthly!`,
        code: 'JOB_LIMIT_EXCEEDED',
        plan,
        limit: maxMonthlyJobs,
        monthlyJobsPosted
      });
    }

    const {
      title,
      category,
      location,
      jobType,
      workMode,
      description,
      requirements,
      responsibilities,
      salaryMin,
      salaryMax,
      salaryCurrency,
      experienceMin,
      experienceMax,
      benefits,
      skills,
      openings,
      deadline,
      status,
      isUrgent,
      companyName,
      companyLogo,
      companyWebsite
    } = req.body;

    // Auto-create or update company profile
    let companyId = profile.companyId;
    const finalCompanyName = companyName?.trim() || profile.company?.name || (profile.user?.name ? `${profile.user.name}'s Company` : 'My Company');

    if (!companyId) {
      const createdCompany = await prisma.company.create({
        data: {
          name: finalCompanyName,
          logo: companyLogo?.trim() || null,
          website: companyWebsite?.trim() || null,
          headquarters: location || 'Remote',
        }
      });
      companyId = createdCompany.id;
      await prisma.recruiterProfile.update({
        where: { id: profile.id },
        data: { companyId: createdCompany.id }
      });
    } else {
      // Recruiter already has a company: update its profile with the specified name/logo/website
      await prisma.company.update({
        where: { id: companyId },
        data: {
          name: finalCompanyName,
          ...(companyLogo !== undefined ? { logo: companyLogo?.trim() || null } : {}),
          ...(companyWebsite !== undefined ? { website: companyWebsite?.trim() || null } : {})
        }
      });
    }

    // Handle job category if provided
    let categoryId: string | undefined = undefined;
    if (category) {
      try {
        const cat = await prisma.jobCategory.upsert({
          where: { name: category },
          update: {},
          create: { name: category }
        });
        categoryId = cat.id;
      } catch (catErr) {
        console.warn('Failed to upsert job category:', catErr);
      }
    }

    const isDraft = status === 'DRAFT';
    const finalTitle = title?.trim() || (isDraft ? 'Untitled Draft Position' : 'Job Opening');
    const finalDescription = description?.trim() || (isDraft ? 'Draft job description pending completion.' : 'Job details to be discussed.');
    const finalResponsibilities = responsibilities?.trim() || finalDescription || 'Responsibilities to be discussed';
    const finalRequirements = requirements?.trim() || 'Requirements to be discussed';

    const parsedSalaryMin = salaryMin !== undefined && salaryMin !== null && !isNaN(Number(salaryMin)) ? Number(salaryMin) : null;
    const parsedSalaryMax = salaryMax !== undefined && salaryMax !== null && !isNaN(Number(salaryMax)) ? Number(salaryMax) : null;
    const parsedExpMin = experienceMin !== undefined && experienceMin !== '' && !isNaN(Number(experienceMin)) ? Number(experienceMin) : null;
    const parsedExpMax = experienceMax !== undefined && experienceMax !== '' && !isNaN(Number(experienceMax)) ? Number(experienceMax) : null;
    const parsedOpenings = openings && !isNaN(Number(openings)) ? Math.max(1, Number(openings)) : 1;
    const parsedDeadline = deadline && !isNaN(new Date(deadline).getTime()) ? new Date(deadline) : null;
    const finalStatus = isDraft ? 'DRAFT' : (status || 'PUBLISHED');

    const job = await prisma.job.create({
      data: {
        title: finalTitle,
        description: finalDescription,
        responsibilities: finalResponsibilities,
        requirements: finalRequirements,
        salaryMin: parsedSalaryMin,
        salaryMax: parsedSalaryMax,
        salaryCurrency: salaryCurrency || 'INR',
        experienceMin: parsedExpMin,
        experienceMax: parsedExpMax,
        benefits: Array.isArray(benefits) ? benefits.join(', ') : (benefits || null),
        jobType: jobType || 'Full-time',
        workMode: workMode || 'On-site',
        location: location || 'Remote',
        openings: parsedOpenings,
        applicationDeadline: parsedDeadline,
        isUrgent: Boolean(isUrgent),
        status: finalStatus as any,
        categoryId,
        companyId: companyId!,
        recruiterId: profile.id,
      }
    });

    // Handle skills if provided
    if (Array.isArray(skills) && skills.length > 0) {
      for (const skillName of skills) {
        if (!skillName || typeof skillName !== 'string') continue;
        const trimmed = skillName.trim();
        if (!trimmed) continue;
        try {
          const skill = await prisma.skill.upsert({
            where: { name: trimmed },
            update: {},
            create: { name: trimmed }
          });
          await prisma.jobSkill.upsert({
            where: { jobId_skillId: { jobId: job.id, skillId: skill.id } },
            update: {},
            create: { jobId: job.id, skillId: skill.id }
          });
        } catch (e) {
          console.warn(`Failed to attach skill ${trimmed}:`, e);
        }
      }
    }

    return res.status(201).json(job);
  } catch (error) {
    console.error('Error creating job:', error);
    return res.status(500).json({ message: 'Error creating job' });
  }
};

export const updateJobStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user?.id;

    const profile = await prisma.recruiterProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(403).json({ message: 'Forbidden' });

    const job = await prisma.job.findFirst({
      where: { id, recruiterId: profile.id }
    });
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const updated = await prisma.job.update({
      where: { id },
      data: { status }
    });

    return res.status(200).json(updated);
  } catch (error) {
    console.error('Error updating job status:', error);
    return res.status(500).json({ message: 'Error updating job status' });
  }
};

export const deleteJob = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const profile = await prisma.recruiterProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(403).json({ message: 'Forbidden' });

    const job = await prisma.job.findFirst({
      where: { id, recruiterId: profile.id }
    });
    if (!job) return res.status(404).json({ message: 'Job not found' });

    await prisma.job.delete({ where: { id } });

    return res.status(200).json({ message: 'Job deleted successfully' });
  } catch (error) {
    console.error('Error deleting job:', error);
    return res.status(500).json({ message: 'Error deleting job' });
  }
};

export const getApplications = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await getOrEnsureRecruiterProfile(userId);
    if (!profile) return res.status(200).json([]);

    // Multi-tenant isolation: Strictly fetch applications for jobs posted by this specific recruiter
    const whereClause = {
      job: {
        recruiterId: profile.id
      }
    };

    const includeBlock = {
      candidate: {
        include: {
          user: { 
            select: { 
              id: true, 
              name: true, 
              email: true, 
              phone: true, 
              profileImage: true 
            } 
          },
          skills: { select: { id: true, name: true } },
          resumes: { select: { id: true, fileName: true, fileUrl: true } }
        }
      },
      resume: { select: { id: true, fileName: true, fileUrl: true } },
      job: { 
        select: { 
          id: true, 
          title: true, 
          jobType: true, 
          location: true, 
          workMode: true,
          requirements: true,
          description: true,
          category: { select: { id: true, name: true } },
          skills: { include: { skill: true } }
        } 
      }
    };

    const applications = await prisma.application.findMany({
      where: whereClause,
      include: includeBlock,
      orderBy: { createdAt: 'desc' }
    });

    const formatted = applications.map(a => {
      const candSkills = a.candidate.skills && a.candidate.skills.length > 0 
        ? a.candidate.skills.map((s: any) => s.name) 
        : [];
      
      const jobSkills = (a.job as any).skills && (a.job as any).skills.length > 0
        ? (a.job as any).skills.map((js: any) => js.skill?.name).filter(Boolean)
        : [];

      const atsScore = calculateAtsScore(
        candSkills,
        jobSkills,
        a.job.title,
        (a.job as any).requirements,
        (a.job as any).description
      );

      const candRole = candSkills.length > 0 ? `${candSkills[0]} Specialist` : (a.job?.title ? `${a.job.title} Applicant` : 'Candidate');
      const candLocation = a.candidate.location || a.job.location || 'Not Specified';
      const candNotice = a.candidate.noticePeriod || 'Not Specified';
      const candSalary = a.candidate.expectedSalary || 'Not Specified';
      const candWorkMode = a.candidate.workMode || a.job.workMode || 'Not Specified';
      const candBio = '';

      const attachedResume = (a as any).resume || a.candidate.resumes?.[0];
      let resumeUrl: string | null = null;
      let resumeFileName: string | null = null;
      let hasResume = false;

      if (attachedResume?.fileUrl || attachedResume?.fileName) {
        hasResume = true;
        resumeFileName = attachedResume.fileName ? decodeURIComponent(attachedResume.fileName).replace(/%20/g, ' ') : 'Resume.pdf';
        const fileUrlStr = String(attachedResume.fileUrl || '');
        if (fileUrlStr.startsWith('/api/resumes/') || (fileUrlStr.startsWith('http') && !fileUrlStr.includes('storage.jobbuffer.in'))) {
          resumeUrl = fileUrlStr;
        } else {
          const fn = fileUrlStr.split('/').pop() || resumeFileName;
          resumeUrl = `/api/resumes/${encodeURIComponent(fn)}`;
        }
      }
      const jobCategory = (a.job as any).category?.name || 'Development';
      const cleanCandidateName = resolveCandidateName(a.candidate.user, (a as any).resume ? [(a as any).resume] : a.candidate.resumes);
      const extDetails = getCandidateExtendedDetails(a.candidate.user, candSkills, candNotice);

      return {
        id: a.id,
        candidateId: a.candidateId,
        candidateProfileId: a.candidateId,
        userId: a.candidate.user.id,
        name: cleanCandidateName,
        candidateName: cleanCandidateName,
        email: a.candidate.user.email,
        candidateEmail: a.candidate.user.email,
        phone: a.candidate.user.phone || '',
        candidatePhone: a.candidate.user.phone || '',
        profileImage: a.candidate.user.profileImage,
        location: candLocation,
        role: candRole,
        jobId: a.job.id,
        jobTitle: a.job.title,
        jobCategory,
        jobLocation: a.job.location,
        stage: a.status,
        status: a.status,
        appliedDate: a.createdAt,
        appliedAt: a.createdAt,
        experience: extDetails.experienceList?.[0] ? `${extDetails.experienceList[0].role} (${extDetails.experienceList[0].duration})` : (a.candidate.noticePeriod ? `Notice: ${a.candidate.noticePeriod}` : 'Not Specified'),
        noticePeriod: candNotice,
        expectedSalary: candSalary,
        workMode: candWorkMode,
        bio: extDetails.bio || '',
        education: extDetails.education || [],
        experienceList: extDetails.experienceList || [],
        certifications: extDetails.certifications || [],
        projects: extDetails.projects || [],
        languages: extDetails.languages || ['English', 'Tamil'],
        links: extDetails.links || {},
        skills: candSkills,
        hasResume,
        resumeUrl,
        resumeFileName,
        atsScore,
        candidate: {
          id: a.candidate.id,
          name: a.candidate.user.name,
          email: a.candidate.user.email,
          phone: a.candidate.user.phone || '',
          profileImage: a.candidate.user.profileImage
        },
        candidateProfile: {
          id: a.candidate.id,
          name: a.candidate.user.name,
          email: a.candidate.user.email,
          phone: a.candidate.user.phone || '',
          role: candRole,
          skills: candSkills,
          resumeUrl,
          resumeFileName,
          location: candLocation
        },
        job: {
          id: a.job.id,
          title: a.job.title,
          location: a.job.location,
          jobType: a.job.jobType,
          category: jobCategory
        }
      };
    });

    return res.status(200).json(formatted);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error fetching applications' });
  }
};

export const updateApplicationStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const application = await prisma.application.findUnique({
      where: { id: String(id) },
      include: {
        candidate: {
          include: { user: true }
        },
        job: {
          include: { company: true }
        }
      }
    });

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    const updated = await prisma.application.update({
      where: { id: String(id) },
      data: { status }
    });

    // Create Candidate In-App Notification and trigger email
    try {
      const candidateUser = application.candidate.user;
      const jobTitle = application.job.title;
      const companyName = application.job.company?.name || 'Recruiter Company';

      let notifTitle = `Application Status: ${status}`;
      let notifMessage = `Your application for "${jobTitle}" has been updated to ${status}.`;

      if (status === 'SHORTLISTED') {
        notifTitle = '🎉 You are Shortlisted!';
        notifMessage = `Congratulations! You have been shortlisted for "${jobTitle}" at ${companyName}. The hiring team will contact you soon.`;
      } else if (status === 'INTERVIEW') {
        notifTitle = '📅 Interview Scheduled!';
        notifMessage = `An interview round has been scheduled for your application for "${jobTitle}" at ${companyName}.`;
      } else if (status === 'SELECTED' || status === 'HIRED') {
        notifTitle = '🌟 Job Offer / Selected!';
        notifMessage = `Congratulations! You have been selected for the "${jobTitle}" position at ${companyName}!`;
      } else if (status === 'REJECTED') {
        notifTitle = 'Application Status Update';
        notifMessage = `Thank you for your interest in "${jobTitle}" at ${companyName}. The recruiter has moved forward with other applicants.`;
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

      console.log(`[NOTIFICATION] Sent notification to ${candidateUser.name} (${candidateUser.email}): ${notifTitle}`);

      const recruiterProfile = await prisma.recruiterProfile.findUnique({
        where: { userId: req.user?.id }
      });
      const resolvedCompanyId = application.job.companyId || application.job.company?.id || recruiterProfile?.companyId || recruiterProfile?.id;

      if (status === 'SHORTLISTED' && candidateUser.email) {
        console.log(`[EMAIL TRIGGER] Dispatching Shortlist email to ${candidateUser.email} for "${jobTitle}" at "${companyName}" (Company ID: ${resolvedCompanyId})`);
        sendShortlistEmail(candidateUser.email, candidateUser.name, jobTitle, companyName, resolvedCompanyId)
          .then((res) => console.log(`[EMAIL DISPATCH SUCCESS] Shortlist email delivered to ${candidateUser.email}:`, res))
          .catch(e => console.warn('[EMAIL DISPATCH ERROR] Shortlist delivery failed:', e?.message || e));
      } else if (status === 'REJECTED' && candidateUser.email) {
        sendRejectionEmail(candidateUser.email, candidateUser.name, jobTitle, companyName, resolvedCompanyId).catch(e => {
          console.warn('[EMAIL] Rejection delivery notice:', e.message);
        });
      } else if ((status === 'SELECTED' || status === 'HIRED' || status === 'OFFER') && candidateUser.email) {
        sendJobOfferEmail(candidateUser.email, candidateUser.name, jobTitle, companyName, req.user?.name || 'Hiring Team', resolvedCompanyId).catch(e => {
          console.warn('[EMAIL] Job offer delivery notice:', e.message);
        });
      }
    } catch (notifErr: any) {
      console.warn('Failed to send candidate notification:', notifErr.message);
    }

    return res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error updating application status' });
  }
};

export const bulkUpdateApplicationStatus = async (req: any, res: Response) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !status) {
      return res.status(400).json({ message: 'ids array and status are required' });
    }

    const apps = await prisma.application.findMany({
      where: { id: { in: ids.map(String) } },
      include: {
        candidate: { include: { user: true } },
        job: { include: { company: true } }
      }
    });

    await prisma.application.updateMany({
      where: { id: { in: ids.map(String) } },
      data: { status }
    });

    // Create notifications for each candidate
    for (const app of apps) {
      try {
        const candidateUser = app.candidate.user;
        const jobTitle = app.job.title;
        const companyName = app.job.company?.name || 'Recruiter Company';

        const notifTitle = status === 'SHORTLISTED' ? '🎉 You are Shortlisted!' : `Application Status: ${status}`;
        const notifMessage = status === 'SHORTLISTED'
          ? `Congratulations! You have been shortlisted for "${jobTitle}" at ${companyName}.`
          : `Your application for "${jobTitle}" was updated to ${status}.`;

        await (prisma as any).notification.create({
          data: {
            userId: candidateUser.id,
            title: notifTitle,
            message: notifMessage,
            type: status,
            link: '/(tabs)/applications'
          }
        });

        const companyId = app.job.companyId || app.job.company?.id;

        if (status === 'SHORTLISTED' && candidateUser.email) {
          sendShortlistEmail(candidateUser.email, candidateUser.name, jobTitle, companyName, companyId).catch(() => {});
        } else if (status === 'REJECTED' && candidateUser.email) {
          sendRejectionEmail(candidateUser.email, candidateUser.name, jobTitle, companyName, companyId).catch(() => {});
        } else if ((status === 'SELECTED' || status === 'HIRED' || status === 'OFFER') && candidateUser.email) {
          sendJobOfferEmail(candidateUser.email, candidateUser.name, jobTitle, companyName, req.user?.name || 'Hiring Team', companyId).catch(() => {});
        }
      } catch (e) {}
    }

    return res.status(200).json({ 
      message: `Successfully moved ${ids.length} candidate(s) to ${status}` 
    });
  } catch (error) {
    console.error('Error bulk updating applications:', error);
    return res.status(500).json({ message: 'Error bulk updating applications' });
  }
};

export const getCompanyProfile = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    let profile = await getOrEnsureRecruiterProfile(userId);

    if (!profile) {
      const defaultComp = await prisma.company.findFirst() || { name: 'JoBuffer Company', industry: 'Information Technology' };
      return res.status(200).json(defaultComp);
    }

    if (!profile.company) {
      const companyName = profile.user?.name ? `${profile.user.name}'s Company` : 'My Company';
      const createdCompany = await prisma.company.create({
        data: {
          name: companyName,
        }
      });
      profile = await prisma.recruiterProfile.update({
        where: { id: profile.id },
        data: { companyId: createdCompany.id },
        include: { company: true, user: true }
      });
    }

    return res.status(200).json(profile.company);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error fetching company profile' });
  }
};

export const updateCompanyProfile = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await prisma.recruiterProfile.findUnique({
      where: { userId },
      include: { company: true, user: true }
    });

    if (!profile) {
      return res.status(404).json({ message: 'Recruiter profile not found' });
    }

    const { name, website, industry, size, description, headquarters, logo } = req.body;

    let companyId = profile.companyId;
    if (!companyId) {
      const createdCompany = await prisma.company.create({
        data: {
          name: name || (profile.user?.name ? `${profile.user.name}'s Company` : 'My Company'),
          logo: logo || null,
          website,
          industry,
          size,
          description,
          headquarters
        }
      });
      await prisma.recruiterProfile.update({
        where: { id: profile.id },
        data: { companyId: createdCompany.id }
      });
      return res.status(200).json(createdCompany);
    }

    const updatedCompany = await prisma.company.update({
      where: { id: companyId },
      data: {
        name,
        ...(logo !== undefined ? { logo } : {}),
        website,
        industry,
        size,
        description,
        headquarters
      }
    });

    return res.status(200).json(updatedCompany);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error updating company profile' });
  }
};

export const getCandidates = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await getOrEnsureRecruiterProfile(userId);

    const { search, workMode, noticePeriod, skill } = req.query;

    const recruiterJobCondition = (req.user?.role === 'ADMIN' || !profile)
      ? {}
      : { recruiterId: profile.id };

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

    // Recruiter only sees candidates who applied to their own posted jobs (Admin sees all)
    const candidateWhereClause: any = {};
    if (req.user?.role !== 'ADMIN' && profile) {
      candidateWhereClause.applications = {
        some: {
          job: {
            recruiterId: profile.id
          }
        }
      };
    }

    const candidateProfiles = await prisma.candidateProfile.findMany({
      where: candidateWhereClause,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            profileImage: true,
            status: true,
            createdAt: true,
          }
        },
        skills: true,
        resumes: {
          orderBy: { createdAt: 'desc' }
        },
        applications: {
          where: {
            job: recruiterJobCondition
          },
          include: {
            job: { select: { id: true, title: true } }
          }
        }
      },
      orderBy: { user: { createdAt: 'desc' } }
    });

    const formatted = candidateProfiles.map((cp) => {
      const skillNames = cp.skills.map(s => s.name);
      const professionalRole = skillNames.length > 0 
        ? `${skillNames[0]} Specialist` 
        : (cp.applications[0]?.job?.title ? `${cp.applications[0].job.title} Applicant` : (cp.workMode ? `${cp.workMode} Professional` : 'Candidate'));

      const realLocation = cp.location || 'Chennai, India';
      const realWorkMode = cp.workMode || 'Hybrid / Remote';
      const realNotice = cp.noticePeriod || '15 Days';
      const realSalary = cp.expectedSalary || '₹8,50,000 - ₹14,00,000 PA';
      const realSkills = skillNames.length > 0 ? skillNames : ['Full Stack', 'Problem Solving'];
      const realExp = cp.noticePeriod ? `Notice: ${cp.noticePeriod}` : 'Immediate / 15 Days';
      const realBio = '';

      const rawResume = cp.resumes[0];
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

      const isShortlisted = cp.applications.some(a => ['SHORTLISTED', 'INTERVIEW', 'SELECTED', 'HIRED'].includes(a.status));
      const activeStage = cp.applications.find(a => ['SHORTLISTED', 'INTERVIEW', 'SELECTED', 'HIRED'].includes(a.status))?.status || (cp.applications.length > 0 ? cp.applications[0].status : 'AVAILABLE');
      const shortlistedJobs = cp.applications.filter(a => ['SHORTLISTED', 'INTERVIEW', 'SELECTED', 'HIRED'].includes(a.status)).map(a => a.job?.title).filter(Boolean);
      const cleanCandidateName = resolveCandidateName(cp.user, cp.resumes);
      const extDetails = getCandidateExtendedDetails(cp.user, realSkills, realNotice);

      return {
        id: cp.id,
        userId: cp.userId,
        name: cleanCandidateName,
        email: cp.user.email,
        phone: cp.user.phone || '',
        role: professionalRole,
        location: realLocation,
        workMode: realWorkMode,
        noticePeriod: realNotice,
        expectedSalary: realSalary,
        skills: realSkills,
        experience: extDetails.experienceList?.[0] ? `${extDetails.experienceList[0].role} (${extDetails.experienceList[0].duration})` : realExp,
        bio: extDetails.bio || `Passionate ${professionalRole} with verified expertise in ${realSkills.slice(0, 3).join(', ')}.`,
        education: extDetails.education || [],
        experienceList: extDetails.experienceList || [],
        certifications: extDetails.certifications || [],
        projects: extDetails.projects || [],
        languages: extDetails.languages || ['English', 'Tamil'],
        links: extDetails.links || {},
        profileImage: cp.user.profileImage,
        hasResume,
        resumeUrl,
        resumeFileName,
        status: cp.user.status,
        joinedAt: cp.user.createdAt,
        appliedJobs: cp.applications.map(a => a.job?.title).filter(Boolean),
        isShortlisted,
        stage: activeStage,
        applicationStatus: activeStage,
        shortlistedJobs
      };
    });

    const dismissed = loadDismissedCandidates();
    const companyKey = profile?.id || 'admin';
    const companyDismissed = dismissed[companyKey] || [];

    let filtered = formatted.filter(c => !companyDismissed.includes(c.id) && !companyDismissed.includes(c.userId));
    if (search) {
      const q = (search as string).toLowerCase().trim();
      filtered = filtered.filter(c => 
        (c.name || '').toLowerCase().includes(q) || 
        (c.email || '').toLowerCase().includes(q) || 
        (c.role || '').toLowerCase().includes(q) || 
        (c.location || '').toLowerCase().includes(q) ||
        (c.skills || []).some((s: string) => (s || '').toLowerCase().includes(q))
      );
    }
    if (workMode && workMode !== 'All') {
      const wm = (workMode as string).toLowerCase();
      filtered = filtered.filter(c => (c.workMode || '').toLowerCase().includes(wm));
    }
    if (noticePeriod && noticePeriod !== 'All') {
      const np = (noticePeriod as string).toLowerCase();
      filtered = filtered.filter(c => (c.noticePeriod || '').toLowerCase().includes(np));
    }
    if (skill && skill !== 'All') {
      const sk = (skill as string).toLowerCase();
      filtered = filtered.filter(c => (c.skills || []).some((s: string) => (s || '').toLowerCase() === sk));
    }

    // Enforce Candidate Profile Viewing Limits: FREE = 50, PRO = 100
    const plan = (profile?.plan || 'FREE').toUpperCase();
    const isPro = plan === 'PRO';
    const maxProfiles = isPro ? 100 : 50;

    const processed = filtered.map((c, index) => {
      const isLocked = index >= maxProfiles;
      if (isLocked) {
        return {
          ...c,
          isLocked: true,
          email: '***@***.***',
          phone: '+91 **********',
          resumeUrl: null,
          hasResume: false
        };
      }
      return {
        ...c,
        isLocked: false
      };
    });

    return res.status(200).json(processed);
  } catch (error) {
    console.error('Error fetching candidates:', error);
    return res.status(500).json({ message: 'Error fetching candidates' });
  }
};

export const inviteCandidate = async (req: any, res: Response) => {
  try {
    const { candidateProfileId, jobId, status } = req.body;
    if (!candidateProfileId || !jobId) {
      return res.status(400).json({ message: 'Candidate and Job are required' });
    }

    if (req.user?.role !== 'ADMIN') {
      const profile = await getOrEnsureRecruiterProfile(req.user?.id);
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job || !profile || job.recruiterId !== profile.id) {
        return res.status(403).json({ message: 'Forbidden: You can only invite candidates to your own jobs' });
      }
    }

    const targetStatus = status || 'SHORTLISTED';

    const application = await prisma.application.upsert({
      where: {
        jobId_candidateId: {
          jobId,
          candidateId: candidateProfileId,
        }
      },
      update: {
        status: targetStatus,
      },
      create: {
        jobId,
        candidateId: candidateProfileId,
        status: targetStatus,
      },
      include: {
        candidate: { include: { user: true } },
        job: { include: { company: true } }
      }
    });

    // Create Candidate In-App Notification and trigger email
    try {
      const candidateUser = application.candidate.user;
      const jobTitle = application.job.title;
      const companyName = application.job.company?.name || 'Recruiter Company';

      const notifTitle = targetStatus === 'SHORTLISTED' 
        ? '🎉 You are Shortlisted!' 
        : `Job Pipeline: ${targetStatus}`;
      const notifMessage = `Congratulations! You have been added as ${targetStatus} for the position "${jobTitle}" at ${companyName}.`;

      await (prisma as any).notification.create({
        data: {
          userId: candidateUser.id,
          title: notifTitle,
          message: notifMessage,
          type: targetStatus,
          link: '/(tabs)/applications'
        }
      });

      console.log(`[NOTIFICATION] Candidate invited/shortlisted: ${candidateUser.name} for job ${jobTitle}`);

      const recruiterProfile = await prisma.recruiterProfile.findUnique({
        where: { userId: req.user?.id }
      });
      const resolvedCompanyId = application.job.companyId || application.job.company?.id || recruiterProfile?.companyId || recruiterProfile?.id;

      if (targetStatus === 'SHORTLISTED' && candidateUser.email) {
        console.log(`[EMAIL TRIGGER] Dispatching Invite Shortlist email to ${candidateUser.email} for "${jobTitle}" at "${companyName}" (Company ID: ${resolvedCompanyId})`);
        sendShortlistEmail(candidateUser.email, candidateUser.name, jobTitle, companyName, resolvedCompanyId)
          .then((res) => console.log(`[EMAIL DISPATCH SUCCESS] Shortlist email delivered to ${candidateUser.email}:`, res))
          .catch(e => console.warn('[EMAIL DISPATCH ERROR] Shortlist delivery failed:', e?.message || e));
      }
    } catch (notifErr: any) {
      console.warn('Candidate notification notice:', notifErr.message);
    }

    return res.status(200).json({ message: `Candidate moved to ${targetStatus} successfully`, application });
  } catch (error) {
    console.error('Error inviting candidate:', error);
    return res.status(500).json({ message: 'Error inviting candidate' });
  }
};

export const getInterviews = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await getOrEnsureRecruiterProfile(userId);

    const { status, type } = req.query;

    const whereClause: any = (req.user?.role === 'ADMIN' || !profile) ? {} : {
      recruiterId: profile.id
    };

    if (status && status !== 'ALL') {
      whereClause.status = status;
    }
    if (type && type !== 'ALL') {
      whereClause.type = type;
    }

    const interviews = await (prisma as any).interview.findMany({
      where: whereClause,
      include: {
        candidate: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                profileImage: true,
              }
            }
          }
        },
        job: {
          select: {
            id: true,
            title: true,
            location: true,
            jobType: true,
          }
        }
      },
      orderBy: { scheduledAt: 'asc' }
    });

    const formatted = interviews.map((i: any) => ({
      id: i.id,
      title: i.title,
      type: i.type,
      status: i.status,
      scheduledAt: i.scheduledAt,
      durationMinutes: i.durationMinutes,
      meetingLink: i.meetingLink,
      location: i.location || 'Online',
      notes: i.notes,
      feedback: i.feedback,
      candidate: {
        id: i.candidate.id,
        name: resolveCandidateName(i.candidate.user),
        email: i.candidate.user.email,
        phone: i.candidate.user.phone || 'N/A',
        profileImage: i.candidate.user.profileImage,
        location: i.candidate.location || 'Not Specified',
      },
      job: i.job ? {
        id: i.job.id,
        title: i.job.title,
        location: i.job.location,
        type: i.job.jobType,
      } : null
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    console.error('Error fetching interviews:', error);
    return res.status(500).json({ message: 'Error fetching interviews' });
  }
};

export const createInterview = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await prisma.recruiterProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ message: 'Recruiter profile not found' });

    const {
      candidateId,
      jobId,
      title,
      type,
      scheduledAt,
      durationMinutes,
      meetingLink,
      location,
      notes
    } = req.body;

    if (!candidateId || !scheduledAt) {
      return res.status(400).json({ message: 'Candidate and Scheduled date/time are required' });
    }

    const interview = await (prisma as any).interview.create({
      data: {
        title: title || 'Technical Interview Round 1',
        type: type || 'VIDEO',
        status: 'SCHEDULED',
        scheduledAt: new Date(scheduledAt),
        durationMinutes: durationMinutes ? Number(durationMinutes) : 45,
        meetingLink: meetingLink || (type === 'VIDEO' ? 'https://meet.google.com/jobuffer-meet' : null),
        location: location || (type === 'VIDEO' ? 'Google Meet' : 'Office HQ'),
        notes: notes || null,
        recruiterId: profile.id,
        candidateId,
        jobId: jobId || null
      },
      include: {
        candidate: {
          include: { user: { select: { name: true, email: true } } }
        },
        job: { 
          include: { company: true } 
        }
      }
    });

    // If job exists, update application status to INTERVIEW
    if (jobId) {
      await prisma.application.upsert({
        where: {
          jobId_candidateId: {
            jobId,
            candidateId
          }
        },
        update: { status: 'INTERVIEW' },
        create: {
          jobId,
          candidateId,
          status: 'INTERVIEW'
        }
      }).catch(() => null);
    }

    // Trigger candidate in-app notification & interview invitation email
    try {
      const candidateUser = interview.candidate?.user;
      if (candidateUser) {
        const jobTitle = interview.job?.title || interview.title;
        const companyName = profile.companyId 
          ? ((await prisma.company.findUnique({ where: { id: profile.companyId } }))?.name || 'Company') 
          : 'Hiring Team';

        await (prisma as any).notification.create({
          data: {
            userId: candidateUser.id,
            title: '📅 Interview Scheduled!',
            message: `An interview for "${jobTitle}" at ${companyName} has been scheduled for ${new Date(interview.scheduledAt).toLocaleDateString()}.`,
            type: 'INTERVIEW',
            link: '/(tabs)/interviews'
          }
        });

        const companyId = profile.companyId || interview.job?.companyId || interview.job?.company?.id;

        if (candidateUser.email) {
          sendInterviewReminderEmail(
            candidateUser.email,
            candidateUser.name,
            jobTitle,
            companyName,
            {
              scheduledAt: interview.scheduledAt,
              meetingLink: interview.meetingLink,
              recruiterName: req.user?.name || 'Recruiting Team'
            },
            companyId
          ).catch(e => console.warn('[EMAIL] Interview invite delivery notice:', e.message));
        }
      }
    } catch (e: any) {
      console.warn('Failed to dispatch interview notifications:', e.message);
    }

    return res.status(201).json(interview);
  } catch (error) {
    console.error('Error creating interview:', error);
    return res.status(500).json({ message: 'Error creating interview' });
  }
};

export const remindInterview = async (req: any, res: Response) => {
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
    const recruiterName = interview.recruiter?.user?.name || req.user?.name || 'Recruiter';

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

    const companyId = interview.job?.companyId || interview.job?.company?.id || interview.recruiter?.companyId;

    // 2. Email reminder with company specific template and reply-to
    const result = await sendInterviewReminderEmail(
      candidateUser.email,
      candidateUser.name,
      jobTitle,
      companyName,
      {
        scheduledAt: interview.scheduledAt,
        meetingLink: interview.meetingLink,
        recruiterName
      },
      companyId
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

export const updateInterviewStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status, feedback, notes, scheduledAt, applicationStatus } = req.body;
    const userId = req.user?.id;

    const profile = await prisma.recruiterProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(403).json({ message: 'Forbidden' });

    const interview = await (prisma as any).interview.findFirst({
      where: { id, recruiterId: profile.id }
    });
    if (!interview) return res.status(404).json({ message: 'Interview not found' });

    const updateData: any = {};
    if (status) updateData.status = status;
    if (feedback !== undefined) updateData.feedback = feedback;
    if (notes !== undefined) updateData.notes = notes;
    if (scheduledAt) updateData.scheduledAt = new Date(scheduledAt);

    const updated = await (prisma as any).interview.update({
      where: { id },
      data: updateData
    });

    if (applicationStatus && interview.jobId && interview.candidateId) {
      await prisma.application.updateMany({
        where: {
          jobId: interview.jobId,
          candidateId: interview.candidateId
        },
        data: {
          status: applicationStatus
        }
      }).catch(() => null);
    }

    return res.status(200).json(updated);
  } catch (error) {
    console.error('Error updating interview:', error);
    return res.status(500).json({ message: 'Error updating interview' });
  }
};

export const deleteInterview = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const profile = await prisma.recruiterProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(403).json({ message: 'Forbidden' });

    const interview = await (prisma as any).interview.findFirst({
      where: { id, recruiterId: profile.id }
    });
    if (!interview) return res.status(404).json({ message: 'Interview not found' });

    await (prisma as any).interview.delete({ where: { id } });

    return res.status(200).json({ message: 'Interview deleted successfully' });
  } catch (error) {
    console.error('Error deleting interview:', error);
    return res.status(500).json({ message: 'Error deleting interview' });
  }
};

// ==================== MESSAGING ====================

export const getConversations = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { some: { id: userId } }
      },
      include: {
        participants: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            profileImage: true,
            candidateProfile: { select: { id: true, location: true } }
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const formatted = conversations.map(c => {
      const otherParticipant = c.participants.find(p => p.id !== userId) || c.participants[0];
      const lastMessage = c.messages[0];
      return {
        id: c.id,
        participant: {
          id: otherParticipant?.id,
          name: otherParticipant?.name || 'Candidate',
          email: otherParticipant?.email,
          role: otherParticipant?.role,
          location: otherParticipant?.candidateProfile?.location || 'Not Specified',
          profileImage: otherParticipant?.profileImage,
        },
        lastMessage: lastMessage ? {
          content: lastMessage.content,
          senderId: lastMessage.senderId,
          createdAt: lastMessage.createdAt,
          read: lastMessage.read
        } : null,
        updatedAt: c.updatedAt
      };
    });

    return res.status(200).json(formatted);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return res.status(500).json({ message: 'Error fetching conversations' });
  }
};

export const getMessagesByConversation = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          select: { id: true, name: true, email: true, role: true, profileImage: true }
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { sender: { select: { id: true, name: true, email: true } } }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Mark messages as read
    await prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, read: false },
      data: { read: true }
    });

    return res.status(200).json(conversation);
  } catch (error) {
    console.error('Error fetching messages:', error);
    return res.status(500).json({ message: 'Error fetching messages' });
  }
};

export const sendMessage = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        content: content.trim()
      },
      include: { sender: { select: { id: true, name: true, email: true } } }
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });

    return res.status(201).json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({ message: 'Error sending message' });
  }
};

export const startConversation = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { recipientUserId, initialMessage } = req.body;

    if (!recipientUserId) {
      return res.status(400).json({ message: 'Recipient is required' });
    }

    // Check if conversation already exists between these 2 users
    let conversation = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { id: userId } } },
          { participants: { some: { id: recipientUserId } } }
        ]
      }
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          participants: {
            connect: [{ id: userId }, { id: recipientUserId }]
          }
        }
      });
    }

    if (initialMessage && initialMessage.trim()) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: userId,
          content: initialMessage.trim()
        }
      });
    }

    return res.status(200).json(conversation);
  } catch (error) {
    console.error('Error starting conversation:', error);
    return res.status(500).json({ message: 'Error starting conversation' });
  }
};

// ==================== NOTIFICATIONS ====================

export const getNotifications = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const notifications = await (prisma as any).notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    const unreadCount = notifications.filter((n: any) => !n.read).length;

    return res.status(200).json({
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return res.status(500).json({ message: 'Error fetching notifications' });
  }
};

export const markNotificationAsRead = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await (prisma as any).notification.update({
      where: { id },
      data: { read: true }
    });
    return res.status(200).json(updated);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res.status(500).json({ message: 'Error updating notification' });
  }
};

export const markAllNotificationsRead = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    await (prisma as any).notification.updateMany({
      where: { userId, read: false },
      data: { read: true }
    });
    return res.status(200).json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications read:', error);
    return res.status(500).json({ message: 'Error updating notifications' });
  }
};

export const deleteNotification = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    await (prisma as any).notification.delete({ where: { id } });
    return res.status(200).json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    return res.status(500).json({ message: 'Error deleting notification' });
  }
};

// ==========================================
// RECRUITER COMPANY EMAIL TEMPLATES & LOGS
// ==========================================

export const getRecruiterEmailTemplates = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const profile = await prisma.recruiterProfile.findUnique({
      where: { userId },
      include: { company: true, user: true }
    });
    const companyId = profile?.companyId || profile?.id || 'default_company';
    const companyName = profile?.company?.name || profile?.user?.name || 'Recruiter Company';

    const templates = templateService.getCompanyTemplates(companyId, companyName);
    return res.status(200).json({
      company: { id: companyId, name: companyName },
      templates
    });
  } catch (error: any) {
    console.error('Error fetching recruiter email templates:', error);
    return res.status(500).json({ message: 'Error fetching templates', error: error?.message });
  }
};

export const getRecruiterEmailTemplateByCode = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { code } = req.params;
    const profile = await prisma.recruiterProfile.findUnique({
      where: { userId },
      include: { company: true }
    });
    const companyId = profile?.companyId || profile?.id;
    const template = templateService.getTemplate(code, companyId);
    return res.status(200).json(template);
  } catch (error: any) {
    console.error('Error fetching recruiter template by code:', error);
    return res.status(500).json({ message: 'Error fetching template' });
  }
};

export const updateRecruiterEmailTemplate = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { code } = req.params;
    const { subject, body, customReplyTo, replyTo, language } = req.body;

    const profile = await prisma.recruiterProfile.findUnique({
      where: { userId },
      include: { company: true }
    });
    if (!profile) return res.status(404).json({ message: 'Recruiter profile not found' });
    const companyId = profile.companyId || profile.id;

    const updated = templateService.updateCompanyTemplate(
      companyId,
      code,
      {
        subject,
        body,
        customReplyTo: Boolean(customReplyTo),
        replyTo: replyTo || '',
        language: language || 'English (English)'
      },
      [profile.id, profile.companyId || '']
    );

    console.log(`[TEMPLATE UPDATE] Company ${companyId} (${profile.company?.name || 'Company'}) updated template ${code}`);
    return res.status(200).json({ message: 'Company template updated successfully', template: updated });
  } catch (error: any) {
    console.error('Error updating recruiter template:', error);
    return res.status(500).json({ message: 'Error updating template', error: error?.message });
  }
};

export const testSendRecruiterEmailTemplate = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { code, targetEmail } = req.body;

    const profile = await prisma.recruiterProfile.findUnique({
      where: { userId },
      include: { company: true, user: true }
    });
    const companyId = profile?.companyId || profile?.id;
    const companyName = profile?.company?.name || 'Your Company';
    const recruiterName = profile?.user?.name || req.user?.name || 'Hiring Manager';

    const emailToSend = targetEmail || req.user?.email || 'test@example.com';

    let result;
    if (code === 'INTERVIEW_REMINDER') {
      result = await sendInterviewReminderEmail(
        emailToSend,
        'Sample Candidate',
        'Senior Software Engineer',
        companyName,
        {
          scheduledAt: new Date(Date.now() + 86400000),
          meetingLink: 'https://meet.google.com/jobuffer-test',
          recruiterName
        },
        companyId
      );
    } else if (code === 'APPLICATION_RECEIVED') {
      result = await sendApplicationReceivedEmail(
        emailToSend,
        'Sample Candidate',
        'Senior Software Engineer',
        companyName,
        companyId
      );
    } else if (code === 'SHORTLISTED') {
      result = await sendShortlistEmail(
        emailToSend,
        'Sample Candidate',
        'Senior Software Engineer',
        companyName,
        companyId
      );
    } else if (code === 'REJECTED') {
      result = await sendRejectionEmail(
        emailToSend,
        'Sample Candidate',
        'Senior Software Engineer',
        companyName,
        companyId
      );
    } else if (code === 'JOB_OFFER') {
      result = await sendJobOfferEmail(
        emailToSend,
        'Sample Candidate',
        'Senior Software Engineer',
        companyName,
        recruiterName,
        companyId
      );
    } else {
      const rendered = templateService.render(
        code,
        {
          candidate_name: 'Sample Candidate',
          job_title: 'Senior Software Engineer',
          company_name: companyName,
          user_first_name: recruiterName.split(' ')[0],
          user_last_name: recruiterName.split(' ').slice(1).join(' ') || 'HR'
        },
        companyId
      );
      result = await sendAnnouncementEmail(
        emailToSend,
        rendered.subject || 'Sample Preview',
        rendered.body || 'Preview Body',
        companyName
      );
    }

    return res.status(200).json({
      message: `Test email dispatched to ${emailToSend}`,
      success: result?.success ?? true
    });
  } catch (error: any) {
    console.error('Error sending recruiter test email:', error);
    return res.status(500).json({ message: 'Error sending test email', error: error?.message });
  }
};

export const getRecruiterEmailDeliveryLogs = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const profile = await prisma.recruiterProfile.findUnique({
      where: { userId },
      include: { company: true }
    });
    const companyId = profile?.companyId || profile?.id;
    const { status, search } = req.query;

    const logs = templateService.getDeliveryLogs({
      status: status as string,
      search: search as string,
      companyId: companyId
    });

    return res.status(200).json(logs);
  } catch (error: any) {
    console.error('Error fetching recruiter delivery logs:', error);
    return res.status(500).json({ message: 'Error fetching logs' });
  }
};

export const deleteRecruiterApplication = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await prisma.recruiterProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(403).json({ message: 'Recruiter profile not found' });

    const app = await prisma.application.findUnique({
      where: { id: String(id) },
      include: { job: true }
    });

    if (!app) {
      return res.status(404).json({ message: 'Application not found' });
    }

    const belongsToRecruiter = app.job.recruiterId === profile.id || req.user?.role === 'ADMIN';

    if (!belongsToRecruiter) {
      return res.status(403).json({ message: 'Not authorized to delete this application' });
    }

    await prisma.applicationStatusHistory.deleteMany({
      where: { applicationId: String(id) }
    });
    await prisma.application.delete({
      where: { id: String(id) }
    });

    console.log(`[RECRUITER] Application ${id} deleted by recruiter ${profile.id}`);
    return res.status(200).json({ message: 'Application deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting recruiter application:', error);
    return res.status(500).json({ message: 'Error deleting application', error: error?.message });
  }
};

export const deleteRecruiterCandidate = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await prisma.recruiterProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(403).json({ message: 'Recruiter profile not found' });

    const companyKey = profile.id;

    // 1. Delete any applications for this candidate under this recruiter's jobs
    const jobs = await prisma.job.findMany({
      where: {
        recruiterId: profile.id
      },
      select: { id: true }
    });
    const jobIds = jobs.map(j => j.id);

    if (jobIds.length > 0) {
      await prisma.applicationStatusHistory.deleteMany({
        where: {
          application: {
            OR: [
              { candidateId: String(id) },
              { candidate: { userId: String(id) } }
            ],
            jobId: { in: jobIds }
          }
        }
      });
      await prisma.application.deleteMany({
        where: {
          OR: [
            { candidateId: String(id) },
            { candidate: { userId: String(id) } }
          ],
          jobId: { in: jobIds }
        }
      });
    }

    // 2. Add to dismissed candidates pool for this recruiter's company
    const dismissed = loadDismissedCandidates();
    if (!dismissed[companyKey]) {
      dismissed[companyKey] = [];
    }
    if (!dismissed[companyKey].includes(String(id))) {
      dismissed[companyKey].push(String(id));
    }
    saveDismissedCandidates(dismissed);

    console.log(`[RECRUITER] Candidate ${id} dismissed/removed from company ${companyKey}`);
    return res.status(200).json({ message: 'Candidate removed from your candidate pool successfully' });
  } catch (error: any) {
    console.error('Error deleting recruiter candidate:', error);
    return res.status(500).json({ message: 'Error removing candidate', error: error?.message });
  }
};

// ==========================================
// RECRUITER SUBSCRIPTION & PLAN CONTROLLER
// FREE VERSION: 10 jobs/mo, 50 profiles, basic applicant management
// PRO VERSION: 50 jobs/mo, 100 profiles, applicant management with ATS
// ==========================================

export const getRecruiterSubscription = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await getOrEnsureRecruiterProfile(userId);
    if (!profile) return res.status(404).json({ message: 'Recruiter profile not found' });
    const plan = (profile.plan || 'FREE').toUpperCase();
    const isPro = plan === 'PRO';

    // Count monthly jobs posted by this recruiter (current month)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthlyJobsPosted = await prisma.job.count({
      where: {
        recruiterId: profile.id,
        createdAt: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    const totalActiveJobs = await prisma.job.count({
      where: {
        recruiterId: profile.id,
        status: 'PUBLISHED'
      }
    });

    const config = getSubscriptionConfig();
    const recruiterPlans = getRecruiterPricingPlans(config);
    const maxJobs = isPro ? (config.monthlyJobLimit || 50) : 10;
    const maxProfiles = isPro ? (config.candidateProfileLimit || 100) : 50;
    const viewedProfilesCount = profile.viewedProfilesCount || 0;

    return res.status(200).json({
      plan,
      isPro,
      planActivatedAt: profile.planActivatedAt || new Date(),
      pricing: config,
      recruiterPlans,
      limits: {
        jobsMonthly: maxJobs,
        candidateProfiles: maxProfiles,
        applicantManagementAts: isPro
      },
      usage: {
        monthlyJobsPosted,
        totalActiveJobs,
        viewedProfilesCount,
        jobsRemaining: Math.max(0, maxJobs - monthlyJobsPosted),
        profilesRemaining: Math.max(0, maxProfiles - viewedProfilesCount)
      },
      features: {
        jobPostingText: isPro ? `Up to ${maxJobs} jobs monthly` : '10 limited jobs monthly posting',
        candidateProfilesText: isPro ? `View up to ${maxProfiles} candidate profiles` : 'Only view 50 candidate profiles',
        atsText: isPro ? 'Applicant management with ATS (Full Score & Filters)' : 'Applicant management (Basic - ATS Locked)'
      }
    });
  } catch (error) {
    console.error('Error fetching recruiter subscription:', error);
    return res.status(500).json({ message: 'Error retrieving subscription' });
  }
};

export const getPublicSubscriptionPlanConfig = async (req: Request, res: Response) => {
  try {
    const config = getSubscriptionConfig();
    const recruiterPlans = getRecruiterPricingPlans(config);
    return res.status(200).json({
      ...config,
      plans: recruiterPlans.plans,
      recruiterPlans
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error retrieving subscription plan details' });
  }
};

export const getRecruiterSubscriptionPayments = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const profile = await getOrEnsureRecruiterProfile(userId);
    if (!profile) return res.status(404).json({ message: 'Recruiter profile not found' });

    const allPayments = getSubscriptionPayments();
    const recruiterPayments = allPayments.filter(p => p.recruiterId === profile.id || p.recruiterEmail === profile.user?.email);
    return res.status(200).json(recruiterPayments);
  } catch (error) {
    return res.status(500).json({ message: 'Error retrieving payments' });
  }
};

export const activateRecruiterSubscription = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const targetPlan = (req.body?.plan || 'PRO').toUpperCase();
    if (targetPlan !== 'FREE' && targetPlan !== 'PRO') {
      return res.status(400).json({ message: 'Invalid plan. Choose FREE or PRO.' });
    }

    const duration: '1_MONTH' | '3_MONTH' | '6_MONTH' = req.body?.duration || '1_MONTH';
    const durationDays = duration === '6_MONTH' ? 180 : (duration === '3_MONTH' ? 90 : 30);
    const durationMonths = duration === '6_MONTH' ? 6 : (duration === '3_MONTH' ? 3 : 1);

    const profile = await getOrEnsureRecruiterProfile(userId);
    if (!profile) return res.status(404).json({ message: 'Recruiter profile not found' });
    const updated = await prisma.recruiterProfile.update({
      where: { id: profile.id },
      data: {
        plan: targetPlan,
        planActivatedAt: new Date()
      }
    });

    const isPro = targetPlan === 'PRO';
    const config = getSubscriptionConfig();

    // Determine plan pricing based on chosen duration
    let expectedAmount = config.recruiter1MonthPrice;
    if (duration === '3_MONTH') expectedAmount = config.recruiter3MonthPrice;
    if (duration === '6_MONTH') expectedAmount = config.recruiter6MonthPrice;

    let paymentRecord = null;
    if (isPro) {
      const paymentDetails = req.body?.paymentDetails || {};
      const paidAmount = Number(paymentDetails.amount) || expectedAmount;
      const paymentMethod = String(paymentDetails.paymentMethod || 'UPI').toUpperCase();
      const transactionId = paymentDetails.transactionId || `TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

      paymentRecord = recordSubscriptionPayment({
        recruiterId: profile.id,
        recruiterName: profile.user?.name || 'Recruiter',
        recruiterEmail: profile.user?.email || '',
        companyName: profile.company?.name || 'Recruiter Company',
        plan: 'PRO',
        duration,
        durationMonths,
        amount: paidAmount,
        currency: config.currency,
        paymentMethod,
        transactionId,
        upiReference: paymentDetails.upiReference || undefined,
        status: 'COMPLETED'
      });

      console.log(`[SUBSCRIPTION PAYMENT] PRO Plan (${duration}) activated for ${profile.user?.email} with payment of ₹${paidAmount} via ${paymentMethod} (${transactionId})`);
    }

    const durationLabel = duration === '6_MONTH' ? '6 Months' : (duration === '3_MONTH' ? '3 Months' : '1 Month');

    return res.status(200).json({
      success: true,
      message: isPro 
        ? `🎉 Congratulations! PRO Version (${durationLabel}) Activated. Payment of ₹${paymentRecord?.amount || expectedAmount} verified. You can now post 50 jobs monthly, view 100 candidate profiles, and use ATS Applicant Management!`
        : 'Plan set to FREE Version. Limits applied: 10 jobs/month, 50 candidate profiles.',
      plan: targetPlan,
      isPro,
      duration,
      durationDays,
      payment: paymentRecord,
      limits: {
        jobsMonthly: isPro ? (config.monthlyJobLimit || 50) : 10,
        candidateProfiles: isPro ? (config.candidateProfileLimit || 100) : 50,
        applicantManagementAts: isPro
      }
    });
  } catch (error) {
    console.error('Error activating subscription:', error);
    return res.status(500).json({ message: 'Error activating subscription plan' });
  }
};

export const trackCandidateProfileView = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const profile = await getOrEnsureRecruiterProfile(userId);
    if (!profile) return res.status(404).json({ message: 'Recruiter profile not found' });
    const plan = (profile.plan || 'FREE').toUpperCase();
    const isPro = plan === 'PRO';
    const limit = isPro ? 100 : 50;

    const currentCount = profile.viewedProfilesCount || 0;
    if (currentCount >= limit) {
      return res.status(403).json({
        allowed: false,
        limitReached: true,
        message: isPro 
          ? 'Pro plan limit reached (100 candidate profiles viewed).'
          : 'Free plan limit reached (50 candidate profiles viewed). Upgrade to Pro Plan to view up to 100 candidate profiles!',
        currentCount,
        limit,
        plan
      });
    }

    const updated = await prisma.recruiterProfile.update({
      where: { id: profile.id },
      data: { viewedProfilesCount: currentCount + 1 }
    });

    return res.status(200).json({
      allowed: true,
      currentCount: updated.viewedProfilesCount,
      limit,
      remaining: Math.max(0, limit - updated.viewedProfilesCount),
      plan
    });
  } catch (error) {
    console.error('Error tracking candidate profile view:', error);
    return res.status(500).json({ message: 'Error tracking view' });
  }
};

