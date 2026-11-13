import { Router } from 'express';
import { prisma } from '../server';
import { sendApplicationReceivedEmail } from '../services/emailService';
import { jobvettaService, getVerifiedCareerUrl, getCompanyLogo } from '../services/jobvettaService';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { isCandidatePro } from '../utils/candidateProfileStore';

const router = Router();

/**
 * 1. GET /api/jobs & /api/v1/jobs
 * Unified endpoint for candidates: supports searching both JoBuffer native jobs
 * and live external Jobvetta openings across India with 30-minute caching.
 */
router.get('/', async (req, res) => {
  try {
    const { 
      q, 
      search, 
      location, 
      source = 'ALL', 
      days = 30, 
      limit = 250,
      refresh,
      urgent
    } = req.query;

    const queryText = (q || search || '') as string;
    const locationText = (location || '') as string;
    const forceRefresh = refresh === 'true' || refresh === '1';
    const isUrgentFilter = urgent === 'true' || urgent === '1';

    let internalJobs: any[] = [];
    let externalJobs: any[] = [];

    // A. Fetch internal JoBuffer database jobs unless client explicitly wants only Jobvetta
    if (source === 'ALL' || source === 'INTERNAL' || source === 'JOBUFFER' || source === 'JOBBUFFER' || source === 'ORASSYS') {
      const whereClause: any = { status: 'PUBLISHED' };

      if (isUrgentFilter) {
        whereClause.isUrgent = true;
      }

      if (queryText && queryText.trim()) {
        whereClause.OR = [
          { title: { contains: queryText.trim(), mode: 'insensitive' } },
          { description: { contains: queryText.trim(), mode: 'insensitive' } },
          { requirements: { contains: queryText.trim(), mode: 'insensitive' } }
        ];
      }

      if (locationText && locationText.trim() && locationText.toLowerCase() !== 'all' && locationText.toLowerCase() !== 'india') {
        whereClause.location = { contains: locationText.trim(), mode: 'insensitive' };
      }

      const dbJobs = await prisma.job.findMany({
        where: whereClause,
        include: {
          company: {
            select: { id: true, name: true, logo: true, headquarters: true, website: true }
          },
          category: true
        },
        orderBy: { createdAt: 'desc' }
      });

      internalJobs = dbJobs.map((j) => {
        const resolvedLogo = getCompanyLogo(j.company?.name || (j as any).department, j.company?.logo);
        return {
          ...j,
          logo: resolvedLogo,
          company: {
            ...j.company,
            logo: resolvedLogo
          },
          isUrgent: Boolean((j as any).isUrgent),
          isExternal: false,
          source: 'JOBBUFFER',
          externalUrl: null,
          applyUrl: `/api/jobs/${j.id}/apply`
        };
      });
    }

    // B. Fetch live external Jobvetta jobs unless client explicitly wants only internal
    let cacheMeta: any = { fromCache: false, rateLimitRemaining: 50 };
    if (source === 'ALL' || source === 'JOBVETTA' || source === 'EXTERNAL') {
      try {
        const jvResult = await jobvettaService.searchJobs({
          q: queryText,
          location: locationText,
          days: Number(days) || 30,
          limit: Number(limit) || 250,
          forceRefresh
        });
        externalJobs = jvResult.jobs;
        cacheMeta = {
          fromCache: jvResult.fromCache,
          rateLimitRemaining: jvResult.rateLimitRemaining,
          ttlMinutes: 30
        };
      } catch (jvErr: any) {
        console.warn('[JOBVETTA ROUTE] Failed to retrieve external jobs:', jvErr?.message);
      }
    }

    // C. Combine & sort: Internal postings first, followed by fresh Jobvetta verified jobs
    // Deduplicate by job ID to guarantee unique keys across all clients
    const seenJobIds = new Set<string>();
    const combined = [...internalJobs, ...externalJobs].filter(job => {
      const jId = String(job.id || (job as any)._id || '');
      if (!jId || seenJobIds.has(jId)) return false;
      seenJobIds.add(jId);
      return true;
    });

    // Response includes caching metadata headers
    res.setHeader('X-Cache-Engine', 'Jobvetta-Cache-v1');
    res.setHeader('X-Cache-TTL', '1800'); // 30 minutes in seconds
    res.setHeader('X-From-Cache', String(cacheMeta.fromCache));

    return res.status(200).json(combined);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return res.status(500).json({ message: 'Error fetching jobs' });
  }
});

/**
 * 2. GET /api/jobs/jobvetta
 * Dedicated Jobvetta endpoint with explicit cache and rate-limit metadata
 */
router.get('/jobvetta', async (req, res) => {
  try {
    const { q, location, days = 30, limit = 250, refresh } = req.query;
    const forceRefresh = refresh === 'true' || refresh === '1';

    const result = await jobvettaService.searchJobs({
      q: q as string,
      location: location as string,
      days: Number(days) || 30,
      limit: Number(limit) || 250,
      forceRefresh
    });

    return res.status(200).json({
      success: true,
      data: result.jobs,
      meta: {
        total: result.totalCount,
        fromCache: result.fromCache,
        ttlMinutes: 30,
        rateLimitRemaining: result.rateLimitRemaining,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('Error in Jobvetta dedicated search:', error);
    return res.status(500).json({ message: 'Error querying Jobvetta API', error: error?.message });
  }
});

/**
 * 3. GET /api/jobs/jobvetta/cache-status
 * Monitoring endpoint displaying 30-min cache health, rate limits, and cleanup telemetry
 */
router.get('/jobvetta/cache-status', (req, res) => {
  const stats = jobvettaService.getStats();
  return res.status(200).json({
    status: 'healthy',
    cachingStrategy: 'In-Memory + Disk Persisted (30m TTL)',
    ...stats
  });
});

/**
 * 4. POST /api/jobs/jobvetta/cleanup
 * Trigger automatic cache cleanup & freshness pruning
 */
router.post('/jobvetta/cleanup', (req, res) => {
  const result = jobvettaService.runAutomaticCleanup();
  return res.status(200).json({
    message: 'Job freshness and cache cleanup executed successfully.',
    ...result,
    timestamp: new Date().toISOString()
  });
});

/**
 * 5. GET /api/jobs/jobvetta/redirect/:id & /api/jobs/external/:id/apply
 * Redirect candidate directly to original employer application website and log analytics
 */
const handleExternalRedirect = async (req: any, res: any) => {
  try {
    const jobId = req.params.id;
    const candidateUserId = req.query.userId || req.query.candidateId;

    const job = await jobvettaService.getJobById(jobId);
    const targetUrl = job?.externalUrl || getVerifiedCareerUrl(job?.company?.name || 'Company');

    // Log the application redirect
    if (job) {
      jobvettaService.logApplyRedirect(job.id, candidateUserId ? String(candidateUserId) : undefined);
    }

    // Redirect to original application website
    return res.redirect(302, targetUrl);
  } catch (error: any) {
    console.error('Error redirecting to external job:', error);
    return res.redirect(302, 'https://www.google.com/search?q=india+jobs+careers');
  }
};

router.get('/jobvetta/redirect/:id', handleExternalRedirect);
router.get('/external/:id/apply', handleExternalRedirect);

/**
 * 6. GET /api/jobs/:id/application-status
 * Live check from the database to see if this candidate applied for this job
 */
router.get('/:id/application-status', async (req, res) => {
  try {
    const rawId = req.params.id;
    const jobId = String(rawId || '').trim();
    const { userId, email } = req.query;

    let user: any = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded: any = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'secret');
        if (decoded?.userId || decoded?.id) {
          user = await prisma.user.findUnique({ where: { id: decoded.userId || decoded.id } });
        }
      } catch {}
    }

    if (!user && userId) {
      user = await prisma.user.findUnique({ where: { id: String(userId) } });
    }
    if (!user && email) {
      user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    }

    if (!user) {
      return res.status(200).json({ applied: false, status: null });
    }

    const cp = await prisma.candidateProfile.findUnique({ where: { userId: user.id } });
    if (!cp) {
      return res.status(200).json({ applied: false, status: null });
    }

    // Check application by exact jobId or stripped prefix
    const application = await prisma.application.findFirst({
      where: {
        candidateId: cp.id,
        OR: [
          { jobId },
          { jobId: jobId.replace(/^jobvetta_/, '') },
          { jobId: `jobvetta_${jobId}` }
        ]
      }
    });

    if (application) {
      return res.status(200).json({
        applied: true,
        status: application.status,
        applicationId: application.id,
        appliedAt: application.createdAt
      });
    }

    return res.status(200).json({ applied: false, status: null });
  } catch (err) {
    return res.status(200).json({ applied: false, status: null });
  }
});

/**
 * 7. GET /api/jobs/:id
 * Supports both internal database jobs and Jobvetta jobs
 */
router.get('/:id', async (req, res) => {
  try {
    const rawId = req.params.id;
    const jobId = String(rawId || '').trim();

    // 1. Check if this is a Jobvetta job
    if (jobId.startsWith('jobvetta_') || jobId.startsWith('jv_')) {
      const jvJob = await jobvettaService.getJobById(jobId);
      if (jvJob) {
        return res.status(200).json({
          ...jvJob,
          companyName: jvJob.company?.name || jvJob.company,
          company: jvJob.company?.name || jvJob.company,
          companyObj: jvJob.company
        });
      }
    }

    // 2. Query internal PostgreSQL database
    let job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        company: true,
        category: true,
        skills: { include: { skill: true } }
      }
    }).catch(() => null);

    // 3. Fallback: try finding by removing prefixes or findFirst
    if (!job) {
      job = await prisma.job.findFirst({
        where: {
          OR: [
            { id: jobId },
            { id: jobId.replace(/^job_/, '') }
          ]
        },
        include: {
          company: true,
          category: true,
          skills: { include: { skill: true } }
        }
      }).catch(() => null);
    }

    // 4. Fallback: check Jobvetta service even if id didn't start with jobvetta_ prefix
    if (!job) {
      const jvJob = await jobvettaService.getJobById(jobId);
      if (jvJob) {
        return res.status(200).json({
          ...jvJob,
          companyName: jvJob.company?.name || jvJob.company,
          company: jvJob.company?.name || jvJob.company,
          companyObj: jvJob.company
        });
      }
    }

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    return res.status(200).json({
      ...job,
      isExternal: false,
      source: 'JOBBUFFER'
    });
  } catch (error) {
    console.error('Error fetching job details:', error);
    return res.status(500).json({ message: 'Error fetching job details' });
  }
});

router.post('/:id/apply', async (req, res) => {
  try {
    const rawId = req.params.id;
    const jobId = String(rawId || '').trim();

    const { 
      userId, 
      email, 
      fullName, 
      name, 
      phone, 
      location, 
      currentLocation,
      workMode, 
      workPreference,
      noticePeriod, 
      expectedSalary, 
      expectedCTC,
      skills, 
      keyTechStack,
      experience, 
      totalExperience,
      education,
      highestQualification,
      bio, 
      summary, 
      coverLetter,
      resumeUrl, 
      resumeName 
    } = req.body;

    // Resolve candidate user from JWT or body parameters
    let user: any = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded: any = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'secret');
        if (decoded?.userId || decoded?.id) {
          user = await prisma.user.findUnique({ where: { id: decoded.userId || decoded.id } });
        }
      } catch {}
    }

    if (!user && userId) {
      user = await prisma.user.findUnique({ where: { id: String(userId) } });
    }
    if (!user && email) {
      user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    }

    // Check phone uniqueness before creating/updating to avoid constraint errors
    let safePhone: string | null = null;
    if (phone && phone !== 'N/A' && phone !== '9876543210') {
      try {
        const existingPhoneUser = await prisma.user.findUnique({ where: { phone: String(phone) } });
        if (!existingPhoneUser || existingPhoneUser.id === user?.id) {
          safePhone = String(phone);
        }
      } catch {}
    }

    // If an email was provided but no user exists yet with that email, create the candidate user for that email!
    if (!user && email) {
      const emailToUse = String(email).toLowerCase().trim();
      const nameToUse = fullName || name || 'Candidate User';
      user = await prisma.user.create({
        data: {
          email: emailToUse,
          name: nameToUse,
          phone: safePhone,
          passwordHash: '$2a$10$eO7oG2N4oR3zI5LwK1gQMeKzWfIuC6g9hY9yL9vX9w7a8b9c0d1e2',
          role: 'CANDIDATE'
        }
      });
    }

    // Only if absolutely NO identifier was provided, fallback to default candidate
    if (!user && !userId && !email) {
      user = await prisma.user.findFirst({
        where: { role: 'CANDIDATE' },
        orderBy: { createdAt: 'desc' }
      });
    }

    // Update user basic details if provided
    const userUpdates: any = {};
    const candidateName = fullName || name;
    if (candidateName && candidateName !== 'Candidate User') {
      userUpdates.name = candidateName;
    }
    if (safePhone && user?.phone !== safePhone) {
      userUpdates.phone = safePhone;
    }
    if (Object.keys(userUpdates).length > 0 && user?.id) {
      try {
        user = await prisma.user.update({
          where: { id: user.id },
          data: userUpdates
        });
      } catch (uErr) {
        console.warn('User update notice:', uErr);
      }
    }

    // Find or create candidate profile
    let candidateProfile = await prisma.candidateProfile.findUnique({
      where: { userId: user.id },
      include: { skills: true, resumes: true }
    });

    if (!candidateProfile) {
      candidateProfile = await prisma.candidateProfile.create({
        data: { userId: user.id },
        include: { skills: true, resumes: true }
      });
    }

    // Check for duplicate application BEFORE processing to prevent double applications
    const existingApplication = await prisma.application.findFirst({
      where: {
        jobId,
        candidateId: candidateProfile.id
      }
    });

    if (existingApplication) {
      return res.status(200).json({
        success: true,
        alreadyApplied: true,
        message: 'You have already applied for this opening. The recruiter has your application.',
        application: existingApplication
      });
    }

    // ----------------------------------------------------
    // DAILY APPLICATION LIMIT CHECK (50 Free / 100 Pro)
    // ----------------------------------------------------
    const isPro = isCandidatePro(user.email) || isCandidatePro(user.id);
    const dailyLimit = isPro ? 100 : 50;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayApplicationsCount = await prisma.application.count({
      where: {
        candidateId: candidateProfile.id,
        createdAt: { gte: startOfToday }
      }
    });

    if (todayApplicationsCount >= dailyLimit) {
      return res.status(429).json({
        success: false,
        error: 'DAILY_LIMIT_REACHED',
        limit: dailyLimit,
        count: todayApplicationsCount,
        isPro,
        message: isPro
          ? `Daily quota reached! You have submitted ${todayApplicationsCount} of ${dailyLimit} applications allowed today on JoBuffer Pro. Quota will reset tomorrow at midnight.`
          : `Daily limit reached! Free accounts can apply for up to 50 jobs per day (${todayApplicationsCount}/${dailyLimit} applied today). Upgrade to JoBuffer Pro to unlock 100 applications/day!`
      });
    }

    // Handle Jobvetta external job applications with permanent DB persistence
    if (jobId.startsWith('jobvetta_') || jobId.startsWith('jv_')) {
      const jvJob = await jobvettaService.getJobById(jobId);
      jobvettaService.logApplyRedirect(jobId, user.id);

      // Ensure company and recruiter exist so foreign keys in Job table are satisfied
      const companyName = jvJob?.company?.name || 'Partner Employer';
      let company = await prisma.company.findFirst({ where: { name: companyName } });
      if (!company) {
        company = await prisma.company.create({
          data: {
            name: companyName,
            headquarters: jvJob?.location || 'India',
            website: jvJob?.externalUrl || 'https://www.google.com'
          }
        });
      }

      let recruiter = await prisma.recruiterProfile.findFirst();
      if (!recruiter) {
        let recUser = await prisma.user.findFirst({ where: { role: 'RECRUITER' } });
        if (!recUser) {
          recUser = await prisma.user.create({
            data: {
              name: 'Hiring Partner',
              email: 'partner.recruiter@jobuffer.com',
              role: 'RECRUITER',
              passwordHash: '$2a$10$eO7oG2N4oR3zI5LwK1gQMeKzWfIuC6g9hY9yL9vX9w7a8b9c0d1e2'
            }
          });
        }
        recruiter = await prisma.recruiterProfile.create({
          data: {
            userId: recUser.id,
            companyId: company.id
          }
        });
      }

      // Upsert Job in database so Application relation is 100% valid
      await prisma.job.upsert({
        where: { id: jobId },
        update: {},
        create: {
          id: jobId,
          title: jvJob?.title || 'Engineering Role',
          description: jvJob?.description || 'Job opening',
          responsibilities: jvJob?.responsibilities || 'Responsibilities',
          requirements: jvJob?.requirements || 'Requirements',
          location: jvJob?.location || 'India',
          workMode: jvJob?.workMode || 'Hybrid',
          jobType: jvJob?.jobType || 'Full-time',
          companyId: company.id,
          recruiterId: recruiter.id,
          status: 'PUBLISHED'
        }
      });

      // Upsert Application in database
      const app = await prisma.application.upsert({
        where: {
          jobId_candidateId: {
            jobId,
            candidateId: candidateProfile.id
          }
        },
        update: { status: 'APPLIED' },
        create: {
          jobId,
          candidateId: candidateProfile.id,
          status: 'APPLIED'
        }
      });

      const targetUrl = jvJob?.externalUrl || getVerifiedCareerUrl(companyName);

      return res.status(200).json({
        success: true,
        isExternal: true,
        source: 'Jobvetta',
        externalUrl: targetUrl,
        redirectUrl: targetUrl,
        message: 'Application recorded and redirecting to official company career portal',
        application: app,
        job: jvJob
      });
    }

    // Determine candidate details with intelligent defaults
    const finalLocation = location || currentLocation || candidateProfile.location || 'Chennai, India';
    const finalWorkMode = workMode || workPreference || candidateProfile.workMode || 'Hybrid / Remote';
    const finalNotice = noticePeriod || candidateProfile.noticePeriod || 'Immediate to 15 Days';
    const finalSalary = expectedSalary || expectedCTC || candidateProfile.expectedSalary || '₹6,00,000 - ₹12,00,000 PA';

    // Update profile fields
    candidateProfile = await prisma.candidateProfile.update({
      where: { id: candidateProfile.id },
      data: {
        location: finalLocation,
        workMode: finalWorkMode,
        noticePeriod: finalNotice,
        expectedSalary: finalSalary
      },
      include: { skills: true, resumes: true }
    });

    // Process and associate candidate skills
    let rawSkillsList: string[] = [];
    if (Array.isArray(skills)) {
      rawSkillsList = skills;
    } else if (typeof skills === 'string' && skills.trim()) {
      rawSkillsList = skills.split(',').map(s => s.trim()).filter(Boolean);
    } else if (typeof keyTechStack === 'string' && keyTechStack.trim()) {
      rawSkillsList = keyTechStack.split(',').map(s => s.trim()).filter(Boolean);
    }

    // If no skills sent and candidate currently has none, inherit from the job skills or default
    if (rawSkillsList.length === 0 && candidateProfile.skills.length === 0) {
      const jobWithSkills = await prisma.job.findUnique({
        where: { id: jobId },
        include: { skills: { include: { skill: true } } }
      });
      if (jobWithSkills?.skills && jobWithSkills.skills.length > 0) {
        rawSkillsList = jobWithSkills.skills.map(js => js.skill.name);
      } else {
        rawSkillsList = ['Python', 'PostgreSQL', 'REST APIs', 'FastAPI', 'Docker', 'React'];
      }
    }

    // Connect skills
    for (const skillName of rawSkillsList) {
      try {
        const sName = String(skillName).trim();
        if (!sName) continue;
        const skill = await prisma.skill.upsert({
          where: { name: sName },
          update: {},
          create: { name: sName }
        });
        await prisma.candidateProfile.update({
          where: { id: candidateProfile.id },
          data: {
            skills: {
              connect: { id: skill.id }
            }
          }
        });
      } catch (skillErr) {
        // Skill already connected or concurrent insert
      }
    }

    // Check or create primary Resume only if candidate actually has/provided one
    let primaryResumeId = candidateProfile.resumes?.[0]?.id || null;
    if (!primaryResumeId && (resumeUrl || resumeName)) {
      const rName = resumeName ? decodeURIComponent(resumeName).replace(/%20/g, ' ') : 'Candidate_Resume.pdf';
      const rUrl = resumeUrl || `https://storage.jobuffer.in/resumes/${user.id}_resume.pdf`;
      try {
        const newResume = await prisma.resume.create({
          data: {
            candidateId: candidateProfile.id,
            fileName: rName,
            fileUrl: rUrl,
            isPrimary: true
          }
        });
        primaryResumeId = newResume.id;
      } catch (rErr) {
        console.warn('Resume creation notice:', rErr);
      }
    }

    // Upsert Application
    const app = await prisma.application.upsert({
      where: {
        jobId_candidateId: {
          jobId,
          candidateId: candidateProfile.id
        }
      },
      update: { 
        status: 'APPLIED',
        ...(primaryResumeId ? { resumeId: primaryResumeId } : {})
      },
      create: {
        jobId,
        candidateId: candidateProfile.id,
        status: 'APPLIED',
        ...(primaryResumeId ? { resumeId: primaryResumeId } : {})
      }
    });

    // Fetch Job & Company metadata for personalized confirmation
    try {
      const jobDetails = await prisma.job.findUnique({
        where: { id: jobId },
        include: { company: true }
      });

      const companyName = jobDetails?.company?.name || 'Recruiter Company';
      const jobTitle = jobDetails?.title || 'Open Position';

      // 1. Create candidate in-app notification
      await (prisma as any).notification.create({
        data: {
          userId: user.id,
          title: 'Application Received',
          message: `Your application for "${jobTitle}" at ${companyName} has been received.`,
          type: 'APPLICATION',
          link: '/(tabs)/applications'
        }
      });

      // 2. Dispatch automated application received confirmation email (using company's custom template)
      if (user.email) {
        const companyId = jobDetails?.companyId || jobDetails?.company?.id;
        sendApplicationReceivedEmail(user.email, user.name, jobTitle, companyName, companyId).catch(emailErr => {
          console.warn('[EMAIL] Application confirmation delivery error:', emailErr?.message);
        });
      }
    } catch (confErr: any) {
      console.warn('Confirmation trigger error:', confErr?.message);
    }

    console.log(`[JOB APPLY] Job ${jobId} applied by candidate ${candidateProfile.id} (${user.name})`);
    return res.status(201).json({ message: 'Application submitted successfully', application: app });
  } catch (error) {
    console.error('Apply error:', error);
    return res.status(500).json({ message: 'Error applying for job' });
  }
});

export default router;
