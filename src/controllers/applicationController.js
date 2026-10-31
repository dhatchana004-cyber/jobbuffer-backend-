const { Application, Job } = require('../models');
const { sendCandidateConfirmationEmail, sendHRNotificationEmail } = require('../utils/mailer');
const pdfParse = require('pdf-parse');

// @desc    Apply for a job
// @route   POST /api/applications
// @access  Private
exports.createApplication = async (req, res) => {
  try {
    const {
      job: jobId, fullName, email, phone, coverLetter, additionalInformation,
      highestQualification, totalExperience, currentLocation, noticePeriod,
      availableToWorkInChennai, expectedCTC, keyTechStack, portfolioLink
    } = req.body;

    // Check if job exists
    const job = await Job.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.status !== 'published') {
      return res.status(400).json({ success: false, message: 'Job is not open for applications' });
    }

    // Deadline validation disabled for demo purposes
    // if (new Date(job.applicationDeadline) < new Date()) {
    //   return res.status(400).json({ success: false, message: 'Application deadline has passed' });
    // }

    // Check if user already applied
    const existingApp = await Application.findOne({ where: { userId: req.user.id, jobId } });
    if (existingApp) {
      return res.status(400).json({ success: false, message: 'You have already applied for this job' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Resume is required' });
    }

    // Create application
    const application = await Application.create({
      userId: req.user.id,
      jobId,
      fullName,
      email,
      phone,
      highestQualification,
      totalExperience,
      currentLocation,
      noticePeriod,
      availableToWorkInChennai,
      expectedCTC,
      keyTechStack,
      portfolioLink,
      resume: req.file.path,
      coverLetter,
      additionalInformation,
    });

    // Send emails
    try {
      await sendCandidateConfirmationEmail({
        applicantName: fullName,
        applicantEmail: email,
        roleTitle: job.title,
      });

      let resumeAttachment = null;
      if (req.file) {
        resumeAttachment = {
          filename: req.file.originalname,
          path: req.file.path
        };
      }

      await sendHRNotificationEmail({
        applicantName: fullName,
        applicantEmail: email,
        applicantPhone: phone,
        roleTitle: job.title,
        experience: totalExperience,
        keySkills: keyTechStack,
        resumeAttachment,
      });
    } catch (emailError) {
      console.error('Email error:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: application,
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ success: false, message: 'You have already applied for this job' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get logged in user's applications
// @route   GET /api/applications/my
// @access  Private
exports.getMyApplications = async (req, res) => {
  try {
    const applications = await Application.findAll({
      where: { userId: req.user.id },
      include: [{ model: Job, as: 'job', attributes: ['title', 'department', 'location'] }]
    });

    res.status(200).json({
      success: true,
      count: applications.length,
      data: applications,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single application of logged in user
// @route   GET /api/applications/my/:id
// @access  Private
exports.getMyApplication = async (req, res) => {
  try {
    const application = await Application.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: [{ model: Job, as: 'job' }]
    });

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    res.status(200).json({
      success: true,
      data: application,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const mammoth = require('mammoth');

// @desc    Parse uploaded resume for auto-fill
// @route   POST /api/applications/parse-resume
// @access  Private
exports.parseResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No resume file uploaded' });
    }

    const fs = require('fs');
    let text = '';

    if (req.file.originalname.toLowerCase().endsWith('.pdf') || req.file.mimetype === 'application/pdf') {
      const dataBuffer = fs.readFileSync(req.file.path);
      const data = await pdfParse(dataBuffer);
      text = data.text;
    } else if (req.file.originalname.toLowerCase().endsWith('.docx') || req.file.mimetype.includes('word')) {
      const result = await mammoth.extractRawText({ path: req.file.path });
      text = result.value;
    } else {
      fs.unlinkSync(req.file.path);
      return res.status(200).json({ success: true, data: {} });
    }

    console.log('--- Resume text extracted, length:', text.length, '---');

    // Clean up text lines (remove tabs, extra whitespace)
    const lines = text.split('\n').map(line => line.replace(/\t/g, ' ').trim()).filter(line => line.length > 0);

    // === EXTRACT NAME ===
    // Skip generic headers like "Resume", "CV", "Profile", empty-ish lines
    let fullName = '';
    const skipPatterns = /^(resume|curriculum vitae|cv|profile|summary|objective|career objective|personal info|contact|details|about me|about|declaration|technical skills|skills|certifications|internship|projects|education|experience|languages|achievements|personal profile|hobbies|interests|strengths|work experience|professional summary|core competencies|areas of expertise)$/i;
    // Common words found in titles, not names
    const jobTitlePatterns = /developer|engineer|stack|programmer|designer|manager|consultant|analyst|architect|specialist|lead|senior|junior|intern|fresher|expert|associate/i;
    
    for (const line of lines) {
      if (skipPatterns.test(line)) continue;
      // Skip Address lines or meaningless short words
      if (/address|location|chennai|india|tamil\s*nadu/i.test(line) && line.length < 30) continue;
      // Skip lines that look like Job Titles
      if (jobTitlePatterns.test(line)) continue;
      
      // A name line is typically short (< 40 chars), no email, no phone, no URL
      if (line.length > 2 && line.length < 45 && !line.includes('@') && !line.includes('+91') && !line.includes('http') && !/\d{5,}/.test(line)) {
        fullName = line.replace(/^Name\s*[:\-]?\s*/i, '').trim();
        // If the name got squished with camelCase (e.g. SuriyaMoorthyG), let's try to add spaces before capitals (except first letter)
        fullName = fullName.replace(/([a-z])([A-Z])/g, '$1 $2');
        break;
      }
    }

    // === EXTRACT EMAIL ===
    const emailMatch = text.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.(?:com|in|org|net|co|edu|mil|gov|io|tech|dev))/i);
    const email = emailMatch ? emailMatch[0] : '';

    // === EXTRACT PHONE ===
    // Indian formats: +91 9743408903, 09743408903, 9743408903, +91-974-340-8903
    const phoneMatch = text.match(/(?:\+91[\s\-]?)?[6-9]\d{4}[\s\-]?\d{5}/) ||
      text.match(/(?:\+\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/);
    const phone = phoneMatch ? phoneMatch[0].trim() : '';

    // === EXTRACT LINKEDIN / GITHUB ===
    const linkedinMatch = text.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^\s|,)]+/i);
    const githubMatch = text.match(/https?:\/\/(www\.)?github\.com\/[^\s|,)]+/i);
    const portfolioLink = linkedinMatch ? linkedinMatch[0] : (githubMatch ? githubMatch[0] : '');

    // === EXTRACT EXPERIENCE ===
    let totalExperience = 'Fresher (0-1 Yrs)';
    // Check for explicit fresher/entry-level mentions
    if (/(fresher|entry[\s-]?level|seeking an entry|0\s*years?|no experience|aspiring|seeking|career objective)/i.test(text)) {
      totalExperience = 'Fresher (0-1 Yrs)';
    } else {
      const expMatch = text.match(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)[\s\-]*(?:of\s+)?(?:experience|exp)/i) ||
        text.match(/(?:experience|exp)[\s:.\-]*(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)/i) ||
        text.match(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)/i);
      if (expMatch) {
        const years = parseFloat(expMatch[1]);
        if (years >= 5) totalExperience = '5+ Years';
        else if (years >= 3) totalExperience = '3-5 Years';
        else if (years >= 1) totalExperience = '1-3 Years';
      }
    }

    // === EXTRACT TECH STACK ===
    // Comprehensive list of tech keywords - case insensitive search
    const techMap = {
      'JavaScript': /\bjavascript\b/i,
      'React.js': /\breact(\.js)?\b/i,
      'Node.js': /\bnode(\.js)?\b/i,
      'Angular': /\bangular\s*(js)?\b/i,
      'Vue.js': /\bvue(\.js)?\b/i,
      'Next.js': /\bnext(\.js)?\b/i,
      'Python': /\bpython\b/i,
      'Java': /\bjava\b(?!\s*script)/i,
      'C++': /\bc\+\+/i,
      'C#': /\bc#/i,
      'PHP': /\bphp\b/i,
      'Ruby': /\bruby\b/i,
      'Swift': /\bswift\b/i,
      'Kotlin': /\bkotlin\b/i,
      'Go': /\bgolang\b|\bgo\s+lang/i,
      'TypeScript': /\btypescript\b/i,
      'HTML': /\bhtml5?\b/i,
      'CSS': /\bcss3?\b/i,
      'Bootstrap': /\bbootstrap\b/i,
      'Tailwind': /\btailwind\b/i,
      'SQL': /\bsql\b/i,
      'MySQL': /\bmysql\b/i,
      'MongoDB': /\bmongodb\b/i,
      'PostgreSQL': /\bpostgres(ql)?\b/i,
      'Express': /\bexpress(\.js)?\b/i,
      'AWS': /\baws\b/i,
      'Docker': /\bdocker\b/i,
      'Git': /\bgit\b(?!\s*hub)/i,
      'GitHub': /\bgithub\b/i,
      'REST API': /\brest(ful)?\s*api/i,
      'Postman': /\bpostman\b/i,
    };

    const foundTech = [];
    for (const [name, regex] of Object.entries(techMap)) {
      if (regex.test(text)) foundTech.push(name);
    }
    const keyTechStack = foundTech.join(', ');

    // === EXTRACT QUALIFICATION ===
    let highestQualification = 'Not explicitly found';
    
    // 1. Safe case-insensitive matches (Degrees that are not common English words)
    const qualMatchSafe = text.match(/\b(Bachelors?|Masters?|B\.Sc|M\.Sc|B\.Com|M\.Com|B\.Tech|M\.Tech|MBA|MCA|BCA|BBA|Ph\.?D|Diploma)\b(?:\s+(?:of|in))?(?:[\s\w,.'&]{1,40}(?:Engineering|Technology|Science|Arts|Commerce|Business|Computer|IT|Information|Application|Management))?/i);
    // 2. Dots required case-insensitive matches (B.E, B.A, M.E, M.A) to avoid matching "be", "me", "ma"
    const qualMatchDots = text.match(/\b(B\.E\.|B\.E|B\.A\.|B\.A|M\.E\.|M\.E|M\.A\.|M\.A)\b(?:\s+(?:of|in))?(?:[\s\w,.'&]{1,40}(?:Engineering|Technology|Science|Arts|Commerce|Business|Computer|IT|Information|Application|Management))?/i);
    // 3. Case-SENSITIVE matches for degree acronyms without dots (BE, BA, ME, MA)
    const qualMatchStrict = text.match(/\b(BE|BA|ME|MA)\b(?:\s+(?:of|in))?(?:[\s\w,.'&]{1,40}(?:Engineering|Technology|Science|Arts|Commerce|Business|Computer|IT|Information|Application|Management))?/);
    
    const finalQualMatch = qualMatchSafe || qualMatchDots || qualMatchStrict;

    if (finalQualMatch) {
      highestQualification = finalQualMatch[0].trim();
      // Clean up newlines or excessive spaces
      highestQualification = highestQualification.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
    }

    // Delete temp file after parsing
    try {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch (e) {
      console.warn('Could not delete temp file (EBUSY expected):', e.message);
    }

    const result = {
      fullName,
      email,
      phone,
      highestQualification,
      totalExperience,
      keyTechStack,
      portfolioLink,
    };

    console.log('--- Parsed result:', JSON.stringify(result, null, 2), '---');

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error parsing resume:', error);
    if (req.file && req.file.path) {
      const fs = require('fs');
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
    res.status(200).json({ success: true, data: {} });
  }
};
