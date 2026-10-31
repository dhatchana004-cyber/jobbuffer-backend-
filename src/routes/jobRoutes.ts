import { Router } from 'express';
import { prisma } from '../server';
import { sendApplicationReceivedEmail } from '../services/emailService';
import { jobvettaService, getVerifiedCareerUrl } from '../services/jobvettaService';

const router = Router();

/**
 * 1. GET /api/jobs & /api/v1/jobs
 * Unified endpoint for candidates: supports searching both Jobbuffer native jobs
 * and live external Jobvetta openings across India with 30-minute caching.
 */
router.get('/', async (req, res) => {
  try {
    const { 
      q, 
      search, 
      location, 
      source = 'ALL', 
      days = 14, 
      limit = 30,
      refresh,
      urgent
    } = req.query;

    const queryText = (q || search || '') as string;
    const locationText = (location || '') as string;
    const forceRefresh = refresh === 'true' || refresh === '1';
    const isUrgentFilter = urgent === 'true' || urgent === '1';

    let internalJobs: any[] = [];
    let externalJobs: any[] = [];

    // A. Fetch internal Jobbuffer database jobs unless client explicitly wants only Jobvetta
    if (source === 'ALL' || source === 'INTERNAL' || source === 'JOBBUFFER' || source === 'ORASSYS') {
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

      internalJobs = dbJobs.map((j) => ({
        ...j,
        isUrgent: Boolean((j as any).isUrgent),
        isExternal: false,
        source: 'JOBBUFFER',
        externalUrl: null,
        applyUrl: `/api/jobs/${j.id}/apply`
      }));
    }

    // B. Fetch live external Jobvetta jobs unless client explicitly wants only internal
    let cacheMeta: any = { fromCache: false, rateLimitRemaining: 50 };
    if (source === 'ALL' || source === 'JOBVETTA' || source === 'EXTERNAL') {
      try {
        const jvResult = await jobvettaService.searchJobs({
          q: queryText,
          location: locationText,
          days: Number(days) || 14,
          limit: Number(limit) || 20,
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
    const combined = [...internalJobs, ...externalJobs];

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
    const { q, location, days = 14, limit = 20, refresh } = req.query;
    const forceRefresh = refresh === 'true' || refresh === '1';

    const result = await jobvettaService.searchJobs({
      q: q as string,
      location: location as string,
      days: Number(days) || 14,
      limit: Number(limit) || 20,
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
 * 6. GET /api/jobs/:id
 * Supports both internal database jobs and Jobvetta jobs
 */
router.get('/:id', async (req, res) => {
  try {
    const jobId = req.params.id;

    // Check if this is a Jobvetta job
    if (jobId.startsWith('jobvetta_') || jobId.startsWith('jv_')) {
      const jvJob = await jobvettaService.getJobById(jobId);
      if (!jvJob) {
        return res.status(404).json({ message: 'External job not found or expired' });
      }
      return res.status(200).json({
        ...jvJob,
        companyName: jvJob.company.name,
        company: jvJob.company.name,
        companyObj: jvJob.company
      });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        company: true,
        category: true,
        skills: { include: { skill: true } }
      }
    });
    if (!job) return res.status(404).json({ message: 'Job not found' });
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
    const jobId = req.params.id;

    // A. Intercept Jobvetta external jobs
    if (jobId.startsWith('jobvetta_') || jobId.startsWith('jv_')) {
      const jvJob = await jobvettaService.getJobById(jobId);
      jobvettaService.logApplyRedirect(jobId, req.body.userId);

      const targetUrl = jvJob?.externalUrl || getVerifiedCareerUrl(jvJob?.company?.name || 'Company');

      return res.status(200).json({
        success: true,
        isExternal: true,
        source: 'Jobvetta',
        externalUrl: targetUrl,
        redirectUrl: targetUrl,
        message: 'Redirecting to official company career portal',
        job: jvJob
      });
    }

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

    let user = null;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: String(userId) } });
    }
    if (!user && email) {
      user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    }
    if (!user) {
      user = await prisma.user.findFirst({
        where: { role: 'CANDIDATE' },
        orderBy: { createdAt: 'desc' }
      });
    }

    if (!user) {
      // Auto-create candidate user if none exists
      const emailToUse = (email && String(email).trim()) || `candidate_${Date.now()}@jobbuffer.com`;
      const nameToUse = fullName || name || 'Candidate User';
      user = await prisma.user.create({
        data: {
          email: emailToUse,
          name: nameToUse,
          phone: phone ? String(phone) : null,
          passwordHash: '$2a$10$eO7oG2N4oR3zI5LwK1gQMeKzWfIuC6g9hY9yL9vX9w7a8b9c0d1e2',
          role: 'CANDIDATE'
        }
      });
    }

    // Update user basic details if provided
    const userUpdates: any = {};
    const candidateName = fullName || name;
    if (candidateName && candidateName !== 'Candidate User') {
      userUpdates.name = candidateName;
    }
    if (phone && phone !== 'N/A' && phone !== '9876543210') {
      userUpdates.phone = phone;
    }
    if (Object.keys(userUpdates).length > 0) {
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
      const rUrl = resumeUrl || `https://storage.jobbuffer.in/resumes/${user.id}_resume.pdf`;
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
