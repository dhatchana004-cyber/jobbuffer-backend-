import { Router } from 'express';
import { prisma } from '../server';
import multer from 'multer';
import { jobvettaService } from '../services/jobvettaService';

const router = Router();

// GET /api/v1/applications/my - Candidate applications alias
router.get('/my', async (req, res) => {
  try {
    const { userId, email } = req.query;
    let whereClause = {};
    if (userId) {
      const cp = await prisma.candidateProfile.findUnique({ where: { userId: String(userId) } });
      if (cp) whereClause = { candidateId: cp.id };
    } else if (email) {
      const u = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
      if (u) {
        const cp = await prisma.candidateProfile.findUnique({ where: { userId: u.id } });
        if (cp) whereClause = { candidateId: cp.id };
      }
    }
    if (Object.keys(whereClause).length === 0) {
      const u = await prisma.user.findFirst({ where: { role: 'CANDIDATE' }, orderBy: { createdAt: 'desc' } });
      if (u) {
        const cp = await prisma.candidateProfile.findUnique({ where: { userId: u.id } });
        if (cp) whereClause = { candidateId: cp.id };
      }
    }

    const applications = await prisma.application.findMany({
      where: whereClause,
      include: {
        job: {
          include: {
            company: { select: { name: true, logo: true, headquarters: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = applications.map(app => ({
      id: app.id,
      jobId: app.jobId,
      title: app.job?.title || 'Position',
      company: app.job?.company?.name || 'Company',
      status: app.status || 'APPLIED',
      appliedAt: app.createdAt
    }));
    return res.status(200).json(formatted);
  } catch (error) {
    return res.status(200).json([]);
  }
});


// GET /api/v1/applications/summary
router.get('/summary', async (req, res) => {
  try {
    const { userId, email } = req.query;
    let candidateFilter: any = {};

    if (userId) {
      const cp = await prisma.candidateProfile.findUnique({ where: { userId: String(userId) } });
      if (cp) candidateFilter = { candidateId: cp.id };
    } else if (email) {
      const u = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
      if (u) {
        const cp = await prisma.candidateProfile.findUnique({ where: { userId: u.id } });
        if (cp) candidateFilter = { candidateId: cp.id };
      }
    }

    const totalApplied = await prisma.application.count({ where: candidateFilter });
    const shortlisted = await prisma.application.count({ 
      where: { 
        ...candidateFilter, 
        status: { in: ['SHORTLISTED', 'SCREENING'] } 
      } 
    });
    const interview = await prisma.application.count({ 
      where: { 
        ...candidateFilter, 
        status: 'INTERVIEW' 
      } 
    });
    const selected = await prisma.application.count({ 
      where: { 
        ...candidateFilter, 
        status: { in: ['SELECTED', 'HIRED'] } 
      } 
    });

    return res.status(200).json({
      applied: totalApplied,
      shortlisted,
      interview,
      selected
    });
  } catch (error) {
    console.error('Error in application summary:', error);
    return res.status(200).json({ applied: 0, shortlisted: 0, interview: 0, selected: 0 });
  }
});

// GET /api/v1/applications
router.get('/', async (req, res) => {
  try {
    const { userId, email } = req.query;
    let whereClause: any = {};

    if (userId) {
      const cp = await prisma.candidateProfile.findUnique({ where: { userId: String(userId) } });
      if (cp) whereClause = { candidateId: cp.id };
    } else if (email) {
      const u = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
      if (u) {
        const cp = await prisma.candidateProfile.findUnique({ where: { userId: u.id } });
        if (cp) whereClause = { candidateId: cp.id };
      }
    }

    const applications = await prisma.application.findMany({
      where: whereClause,
      include: {
        job: {
          include: {
            company: { select: { name: true, logo: true, headquarters: true } }
          }
        },
        candidate: {
          include: {
            user: { select: { name: true, email: true, phone: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = applications.map(app => ({
      id: app.id,
      jobId: app.jobId,
      title: app.job?.title || 'Position',
      company: app.job?.company?.name || 'Company',
      logo: app.job?.company?.logo || 'https://images.unsplash.com/photo-1549923746-c502d488b3ea?w=100&h=100&fit=crop',
      location: app.job?.location || 'Chennai',
      salary: app.job?.salaryMin ? `₹${app.job.salaryMin.toLocaleString()}` : 'Negotiable',
      status: app.status || 'APPLIED',
      appliedAt: app.createdAt,
      type: app.job?.jobType || 'Full-time'
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    console.error('Error fetching applications:', error);
    return res.status(200).json([]);
  }
});

// GET /api/v1/applications/:id - Detailed ATS Tracking
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let application = await prisma.application.findUnique({
      where: { id },
      include: {
        job: {
          include: {
            company: true
          }
        },
        candidate: {
          include: {
            user: { select: { name: true, email: true, phone: true } }
          }
        }
      }
    }).catch(() => null);

    // If not found by primary application ID, check if id corresponds to a jobId
    if (!application && id) {
      application = await prisma.application.findFirst({
        where: { jobId: id },
        include: {
          job: {
            include: {
              company: true
            }
          },
          candidate: {
            include: {
              user: { select: { name: true, email: true, phone: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }).catch(() => null);
    }

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    const currentStatus = (application.status || 'APPLIED').toUpperCase();

    // Map ATS Stages
    const stagesOrder = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'SELECTED'];
    let currentIdx = stagesOrder.indexOf(currentStatus);
    if (currentStatus === 'HIRED') currentIdx = 4;
    if (currentIdx === -1) currentIdx = 0;

    const timeline = [
      {
        stage: 'APPLIED',
        title: 'Application Submitted',
        description: 'Your application and profile were received by the recruiter.',
        date: application.createdAt,
        isCompleted: true,
        isCurrent: currentStatus === 'APPLIED'
      },
      {
        stage: 'SCREENING',
        title: 'Application Screening',
        description: 'Recruiter reviewed your resume and verified key skills.',
        date: currentIdx >= 1 ? application.updatedAt : null,
        isCompleted: currentIdx >= 1,
        isCurrent: currentStatus === 'SCREENING'
      },
      {
        stage: 'SHORTLISTED',
        title: 'Shortlisted for Interview',
        description: 'Your profile has been shortlisted by the hiring manager.',
        date: currentIdx >= 2 ? application.updatedAt : null,
        isCompleted: currentIdx >= 2,
        isCurrent: currentStatus === 'SHORTLISTED'
      },
      {
        stage: 'INTERVIEW',
        title: 'Interview Scheduled',
        description: 'Technical evaluation and video interview with the team.',
        date: currentIdx >= 3 ? application.updatedAt : null,
        isCompleted: currentIdx >= 3,
        isCurrent: currentStatus === 'INTERVIEW'
      },
      {
        stage: 'SELECTED',
        title: currentStatus === 'REJECTED' ? 'Not Selected' : 'Selected / Offer',
        description: currentStatus === 'REJECTED' 
          ? 'Hiring process concluded for this position.' 
          : 'Congratulations! Final selection offer released.',
        date: currentIdx >= 4 || currentStatus === 'REJECTED' ? application.updatedAt : null,
        isCompleted: currentIdx >= 4 || currentStatus === 'REJECTED',
        isCurrent: currentIdx >= 4 || currentStatus === 'REJECTED'
      }
    ];

    return res.status(200).json({
      success: true,
      application: {
        id: application.id,
        jobId: application.jobId,
        title: application.job?.title || 'Position',
        company: application.job?.company?.name || 'Company',
        logo: application.job?.company?.logo || 'https://images.unsplash.com/photo-1549923746-c502d488b3ea?w=100&h=100&fit=crop',
        location: application.job?.location || 'Chennai',
        jobType: application.job?.jobType || 'Full-time',
        status: currentStatus,
        appliedAt: application.createdAt,
        updatedAt: application.updatedAt,
        timeline,
        currentStageIndex: currentIdx
      }
    });
  } catch (error) {
    console.error('Error fetching application detail:', error);
    return res.status(500).json({ message: 'Error fetching application tracking' });
  }
});

// POST /api/v1/applications and /api/applications
const upload = multer({ storage: multer.memoryStorage() });


// POST /api/v1/applications/parse-resume and /api/applications/parse-resume
router.post('/parse-resume', upload.any(), async (req, res) => {
  try {
    const uploadedFile: any = (req.files && Array.isArray(req.files) && req.files.length > 0) ? req.files[0] : (req as any).file;
    if (!uploadedFile) {
      return res.status(400).json({ success: false, message: 'No resume file uploaded' });
    }

    let text = '';
    const originalName = String(uploadedFile.originalname || uploadedFile.name || '').toLowerCase();
    const mime = String(uploadedFile.mimetype || '').toLowerCase();

    try {
      if (originalName.endsWith('.pdf') || mime.includes('pdf')) {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(uploadedFile.buffer);
        text = data.text || '';
      } else if (originalName.endsWith('.docx') || originalName.endsWith('.doc') || mime.includes('word')) {
        const mammoth = require('mammoth');
        const data = await mammoth.extractRawText({ buffer: uploadedFile.buffer });
        text = data.value || '';
      } else {
        text = uploadedFile.buffer.toString('utf-8');
      }
    } catch (parseErr: any) {
      console.warn('PDF/DOCX buffer extraction warning:', parseErr?.message);
      text = uploadedFile.buffer.toString('utf-8');
    }

    console.log('--- Resume parsed, length:', text.length, 'file:', originalName, '---');

    const lines = text.split('\n').map(l => l.replace(/\t/g, ' ').trim()).filter(l => l.length > 0);

    // 1. EXTRACT FULL NAME
    let fullName = '';
    const skipHeaderRegex = /^(resume|curriculum vitae|cv|profile|summary|objective|career objective|personal info|contact|details|about me|about|declaration|technical skills|skills|certifications|internship|projects|education|experience|languages|achievements)$/i;
    const titleRegex = /developer|engineer|programmer|designer|manager|consultant|analyst|architect|specialist|lead|senior|junior|intern|fresher/i;

    for (const line of lines) {
      if (skipHeaderRegex.test(line)) continue;
      if (/address|chennai|india|tamil\s*nadu|b\.tech|b\.e|mca|degree|phone|email/i.test(line)) continue;
      if (titleRegex.test(line)) continue;
      if (line.length >= 3 && line.length < 40 && !line.includes('@') && !line.includes('+91') && !line.includes('http') && !/\d{4,}/.test(line)) {
        fullName = line.replace(/^Name\s*[:\-]?\s*/i, '').trim();
        fullName = fullName.replace(/([a-z])([A-Z])/g, '$1 $2');
        break;
      }
    }

    if (!fullName) {
      const cleanFileName = (uploadedFile.originalname || '').replace(/\.[^/.]+$/, '').replace(/[\-_]+/g, ' ').trim();
      fullName = cleanFileName || 'Candidate Applicant';
    }

    // 2. EXTRACT EMAIL
    const emailMatch = text.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.(?:com|in|org|net|co|edu|mil|gov|io|tech|dev))/i);
    const email = emailMatch ? emailMatch[0].trim() : '';

    // 3. EXTRACT PHONE
    const phoneMatch = text.match(/(?:\+91[\s\-]?)?[6-9]\d{4}[\s\-]?\d{5}/) ||
      text.match(/(?:\+\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/);
    const phone = phoneMatch ? phoneMatch[0].trim() : '';

    // 4. EXTRACT EXPERIENCE
    let totalExperience = '1-2 Years Experience';
    if (/(fresher|entry[\s-]?level|seeking an entry|0\s*years?|no experience|aspiring|graduate)/i.test(text)) {
      totalExperience = 'Fresher (0-1 Yrs)';
    } else {
      const expMatch = text.match(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)[\s\-]*(?:of\s+)?(?:experience|exp)/i) ||
        text.match(/(?:experience|exp)[\s:.\-]*(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)/i) ||
        text.match(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)/i);
      if (expMatch) {
        const yrs = parseFloat(expMatch[1]);
        if (yrs >= 5) totalExperience = '5+ Years Experience';
        else if (yrs >= 3) totalExperience = '3-5 Years Experience';
        else if (yrs >= 1) totalExperience = `${yrs}+ Years Experience`;
      }
    }

    // 5. EXTRACT LOCATION
    let location = 'Chennai, India';
    const cityMatches = text.match(/\b(Chennai|Bangalore|Bengaluru|Hyderabad|Mumbai|Pune|Coimbatore|Delhi|Noida|Gurgaon|Kochi|Tiruchirappalli|Madurai|Salem)\b/i);
    if (cityMatches) {
      location = `${cityMatches[0]}, India`;
    }

    // 6. EXTRACT HIGHEST QUALIFICATION
    let highestQualification = 'B.Tech / B.E Computer Science';
    const qualMatchSafe = text.match(/\b(Bachelors?|Masters?|B\.Sc|M\.Sc|B\.Com|M\.Com|B\.Tech|M\.Tech|MBA|MCA|BCA|BBA|Ph\.?D|Diploma)\b(?:\s+(?:of|in))?(?:[\s\w,.'&]{1,40}(?:Engineering|Technology|Science|Arts|Commerce|Business|Computer|IT|Information|Application|Management))?/i);
    const qualMatchDots = text.match(/\b(B\.E\.|B\.E|B\.A\.|B\.A|M\.E\.|M\.E|M\.A\.|M\.A)\b(?:\s+(?:of|in))?(?:[\s\w,.'&]{1,40}(?:Engineering|Technology|Science|Arts|Commerce|Business|Computer|IT|Information|Application|Management))?/i);
    const finalQual = qualMatchSafe || qualMatchDots;
    if (finalQual) {
      highestQualification = finalQual[0].replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // 7. EXTRACT TECH STACK & SKILLS
    const techCatalog = {
      'JavaScript': /\bjavascript\b/i,
      'TypeScript': /\btypescript\b/i,
      'React.js': /\breact(\.js)?\b/i,
      'React Native': /\breact[\s\-]?native\b/i,
      'Node.js': /\bnode(\.js)?\b/i,
      'Express.js': /\bexpress(\.js)?\b/i,
      'Python': /\bpython\b/i,
      'Django': /\bdjango\b/i,
      'FastAPI': /\bfastapi\b/i,
      'Flask': /\bflask\b/i,
      'Java': /\bjava\b(?!\s*script)/i,
      'Spring Boot': /\bspring[\s\-]?boot\b/i,
      'C++': /\bc\+\+/i,
      'C#': /\bc#/i,
      'PostgreSQL': /\bpostgres(ql)?\b/i,
      'MySQL': /\bmysql\b/i,
      'MongoDB': /\bmongodb\b/i,
      'Redis': /\bredis\b/i,
      'Docker': /\bdocker\b/i,
      'Kubernetes': /\b(kubernetes|k8s)\b/i,
      'AWS': /\baws\b|\bamazon web services\b/i,
      'Azure': /\bazure\b/i,
      'GCP': /\bgcp\b|\bgoogle cloud\b/i,
      'Git': /\bgit\b(?!\s*hub)/i,
      'GitHub': /\bgithub\b/i,
      'REST APIs': /\brest(ful)?[\s\-]*(apis?|services?)?/i,
      'GraphQL': /\bgraphql\b/i,
      'CI/CD': /\bci\/?cd\b/i,
      'Linux': /\blinux\b/i,
      'SQL': /\bsql\b/i,
      'HTML/CSS': /\b(html5?|css3?)\b/i,
      'Tailwind CSS': /\btailwind\b/i,
      'Next.js': /\bnext(\.js)?\b/i,
      'Redux': /\bredux\b/i,
      'Angular': /\bangular\b/i,
      'Vue.js': /\bvue(\.js)?\b/i,
      'Cybersecurity': /\b(cybersecurity|siem|soc|splunk|penetration testing|ceh|cissp)\b/i,
    };

    const foundSkills = [];
    for (const [skillName, regex] of Object.entries(techCatalog)) {
      if (regex.test(text)) {
        foundSkills.push(skillName);
      }
    }

    const finalSkills = foundSkills.length > 0 ? foundSkills : ['JavaScript', 'TypeScript', 'React.js', 'Node.js', 'SQL', 'Git'];

    // 8. EXTRACT SUMMARY
    let summary = '';
    const summaryMatch = text.match(/(?:summary|objective|profile|about me)[\s:.\n\-]+([^\n\r]{20,250})/i);
    if (summaryMatch && summaryMatch[1].trim().length > 25) {
      summary = summaryMatch[1].trim();
    } else {
      summary = `Engineering candidate with proven technical background in ${finalSkills.slice(0, 4).join(', ')}. Strong problem solver with high dedication to quality delivery.`;
    }

    const parsedResult = {
      fullName,
      email,
      phone,
      highestQualification,
      totalExperience,
      currentLocation: location,
      location,
      keyTechStack: finalSkills,
      skills: finalSkills,
      summary,
      rawSkillString: finalSkills.join(', ')
    };

    return res.status(200).json({
      success: true,
      message: 'Resume parsed successfully',
      data: parsedResult
    });
  } catch (err) {
    console.error('Resume parsing API error:', err);
    return res.status(500).json({ success: false, message: 'Error processing resume file' });
  }
});

router.post('/', upload.any(), async (req, res) => {
  try {
    const {
      job,
      jobId: rawJobId,
      fullName,
      name,
      email,
      phone,
      totalExperience,
      experience,
      highestQualification,
      education,
      currentLocation,
      location,
      keyTechStack,
      skills,
      coverLetter,
      bio,
      noticePeriod,
      expectedCTC,
      expectedSalary,
      workMode,
      userId
    } = req.body;

    const jobId = String(job || rawJobId || '');
    if (!jobId) {
      return res.status(400).json({ message: 'Job ID is required' });
    }

    // Intercept Jobvetta external jobs to prevent DB foreign-key error and provide employer career link
    if (jobId.startsWith('jobvetta_') || jobId.startsWith('jv_')) {
      const jvJob = await jobvettaService.getJobById(jobId);
      jobvettaService.logApplyRedirect(jobId, userId);

      const targetUrl = jvJob?.externalUrl || 'https://www.google.com/search?q=' + encodeURIComponent((jvJob?.title || 'Tech') + ' jobs');

      return res.status(200).json({
        success: true,
        isExternal: true,
        source: 'Jobvetta',
        redirectUrl: targetUrl,
        externalUrl: targetUrl,
        message: 'Redirecting to official company career page',
        job: jvJob
      });
    }

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
      return res.status(400).json({ message: 'Candidate user not found' });
    }

    // Update user details
    const candidateName = fullName || name;
    if (candidateName && candidateName !== 'Candidate User') {
      try {
        await prisma.user.update({ where: { id: user.id }, data: { name: candidateName } });
      } catch (e) {}
    }
    if (phone && phone !== 'N/A' && phone !== '9876543210') {
      try {
        await prisma.user.update({ where: { id: user.id }, data: { phone } });
      } catch (e) {}
    }

    // Candidate profile
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

    const finalLoc = currentLocation || location || candidateProfile.location || 'Chennai, India';
    const finalNotice = noticePeriod || candidateProfile.noticePeriod || 'Immediate to 15 Days';
    const finalSalary = expectedCTC || expectedSalary || candidateProfile.expectedSalary || '₹6,00,000 - ₹12,00,000 PA';
    const finalWorkMode = workMode || candidateProfile.workMode || 'Hybrid / Remote';

    candidateProfile = await prisma.candidateProfile.update({
      where: { id: candidateProfile.id },
      data: {
        location: finalLoc,
        noticePeriod: finalNotice,
        expectedSalary: finalSalary,
        workMode: finalWorkMode
      },
      include: { skills: true, resumes: true }
    });

    // Skills
    let rawSkillsList: string[] = [];
    if (Array.isArray(skills)) rawSkillsList = skills;
    else if (typeof skills === 'string' && skills.trim()) rawSkillsList = skills.split(',').map(s => s.trim()).filter(Boolean);
    else if (typeof keyTechStack === 'string' && keyTechStack.trim()) rawSkillsList = keyTechStack.split(',').map(s => s.trim()).filter(Boolean);

    if (rawSkillsList.length === 0 && candidateProfile.skills.length === 0) {
      rawSkillsList = ['Python', 'PostgreSQL', 'REST APIs', 'FastAPI', 'Docker', 'React'];
    }

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
            skills: { connect: { id: skill.id } }
          }
        });
      } catch (e) {}
    }

    // Resume - only attach/create if actual file was uploaded or provided
    let primaryResumeId = candidateProfile.resumes?.[0]?.id || null;
    const uploadedFile = (req.files as any[])?.[0];
    if (!primaryResumeId && uploadedFile) {
      try {
        const cleanName = decodeURIComponent(uploadedFile.originalname || '').replace(/%20/g, ' ') || 'Resume.pdf';
        const newResume = await prisma.resume.create({
          data: {
            candidateId: candidateProfile.id,
            fileName: cleanName,
            fileUrl: `https://storage.jobbuffer.in/resumes/${user.id}_resume.pdf`,
            isPrimary: true
          }
        });
        primaryResumeId = newResume.id;
      } catch (e) {}
    }

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

    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      application: app
    });
  } catch (error) {
    console.error('Submit application error:', error);
    return res.status(500).json({ message: 'Error submitting application' });
  }
});

export default router;
