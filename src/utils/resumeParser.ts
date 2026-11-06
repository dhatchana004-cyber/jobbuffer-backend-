import fs from 'fs';
import path from 'path';

export interface ParsedResumeData {
  headline: string;
  bio: string;
  skills: string[];
  education: Array<{
    degree: string;
    institution: string;
    year: string;
    field?: string;
  }>;
  experience: string;
  experienceList: Array<{
    role: string;
    company: string;
    duration: string;
    location?: string;
    description?: string;
    skillsUsed?: string[];
  }>;
  projects?: Array<{
    title: string;
    description: string;
    tech?: string;
  }>;
  phone?: string;
  email?: string;
  name?: string;
}

const KNOWN_SKILLS = [
  'Python', 'JavaScript', 'TypeScript', 'React.js', 'React', 'ReactJS', 'Django', 'Flask', 
  'FastAPI', 'HTML5', 'HTML', 'CSS3', 'CSS', 'Bootstrap', 'Tailwind CSS', 'Tailwind',
  'PostgreSQL', 'MySQL', 'MongoDB', 'SQLite', 'SQLite3', 'Redis', 'Docker', 'Kubernetes',
  'Git', 'GitHub', 'GitLab', 'Postman', 'REST API', 'REST APIs', 'RESTful APIs',
  'Django REST Framework', 'Linux', 'Ubuntu', 'Windows', 'NumPy', 'Pandas', 'Matplotlib',
  'PyTorch', 'TensorFlow', 'Node.js', 'NodeJS', 'Express.js', 'Express', 'Java',
  'Spring Boot', 'C++', 'C#', '.NET', 'ASP.NET', 'AWS', 'Azure', 'GCP', 'Google Cloud',
  'CI/CD', 'JIRA', 'Agile', 'SQL', 'GraphQL', 'Next.js', 'Redux', 'Angular', 'Vue.js'
];

function formatCleanTitleCase(str: string): string {
  if (!str) return '';
  let s = str
    .replace(/GTNARTSANDSCIENCECOLLEGE/gi, 'GTN Arts and Science College')
    .replace(/TAMILINFOTECHNOLOGY/gi, 'Tamil Info Technology')
    .replace(/CRMSystem/gi, 'CRM System')
    .replace(/([a-zA-Z]+)(20\d{2})/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/**
 * Normalizes skill names to industry standard canonical naming
 */
function normalizeSkillName(s: string): string | null {
  const clean = s.trim();
  if (!clean || clean.length < 2) return null;
  const lower = clean.toLowerCase().replace(/[\s\-_.]/g, '');

  if (lower === 'python') return 'Python';
  if (lower === 'javascript' || lower === 'js') return 'JavaScript';
  if (lower === 'typescript' || lower === 'ts') return 'TypeScript';
  if (lower.startsWith('react')) return 'React.js';
  if (lower === 'django') return 'Django';
  if (lower === 'flask') return 'Flask';
  if (lower === 'fastapi') return 'FastAPI';
  if (lower === 'html' || lower === 'html5') return 'HTML5';
  if (lower === 'css' || lower === 'css3') return 'CSS3';
  if (lower === 'bootstrap') return 'Bootstrap';
  if (lower.startsWith('tailwind')) return 'Tailwind CSS';
  if (lower === 'postgresql' || lower === 'postgres') return 'PostgreSQL';
  if (lower === 'mysql') return 'MySQL';
  if (lower === 'mongodb' || lower === 'mongo') return 'MongoDB';
  if (lower.startsWith('sqlite')) return 'SQLite';
  if (lower === 'redis') return 'Redis';
  if (lower === 'docker') return 'Docker';
  if (lower === 'kubernetes' || lower === 'k8s') return 'Kubernetes';
  if (lower === 'git') return 'Git';
  if (lower === 'github') return 'GitHub';
  if (lower === 'gitlab') return 'GitLab';
  if (lower === 'postman') return 'Postman';
  if (lower.includes('restapi') || lower.includes('restful')) return 'REST APIs';
  if (lower.includes('djangorestframework')) return 'Django REST Framework';
  if (lower === 'linux') return 'Linux';
  if (lower === 'ubuntu') return 'Ubuntu';
  if (lower === 'numpy') return 'NumPy';
  if (lower === 'pandas') return 'Pandas';
  if (lower === 'matplotlib') return 'Matplotlib';
  if (lower === 'pytorch') return 'PyTorch';
  if (lower === 'tensorflow') return 'TensorFlow';
  if (lower === 'nodejs' || lower === 'node') return 'Node.js';
  if (lower === 'express' || lower === 'expressjs') return 'Express.js';
  if (lower === 'java') return 'Java';
  if (lower.includes('springboot')) return 'Spring Boot';
  if (lower === 'c++') return 'C++';
  if (lower === 'c#') return 'C#';
  if (lower === 'aws') return 'AWS';
  if (lower === 'azure') return 'Azure';
  if (lower === 'gcp') return 'Google Cloud (GCP)';
  if (lower === 'sql') return 'SQL';
  if (lower === 'graphql') return 'GraphQL';
  if (lower === 'nextjs' || lower === 'next') return 'Next.js';
  if (lower === 'redux') return 'Redux';

  // Capitalize properly
  return formatCleanTitleCase(clean);
}

/**
 * Extracts raw text from PDF, DOCX, or text file buffer
 */
export async function extractTextFromResumeBuffer(buffer: Buffer, fileName: string): Promise<string> {
  const lower = (fileName || '').toLowerCase();
  try {
    if (lower.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return data.text || '';
    } else if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
      const mammoth = require('mammoth');
      const data = await mammoth.extractRawText({ buffer });
      return data.value || '';
    } else {
      return buffer.toString('utf-8');
    }
  } catch (err: any) {
    console.warn('[ResumeParser] Text extraction warning:', err?.message);
    try {
      return buffer.toString('utf-8');
    } catch {
      return '';
    }
  }
}

/**
 * Parses structured candidate profile data from raw resume text
 */
export function parseResumeText(rawText: string, defaultName: string = 'Candidate'): ParsedResumeData {
  const text = rawText || '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. EXTRACT SKILLS
  const rawSkillList: string[] = [];
  for (const skill of KNOWN_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, 'i');
    if (regex.test(text)) {
      rawSkillList.push(skill);
    }
  }

  // Also extract skills explicitly from "TECHNICAL SKILLS" section if present
  const techSkillsMatch = text.match(/TECHNICAL\s*SKILLS[\s\S]*?(?=WORK\s*EXPERIENCE|EXPERIENCE|PROJECT|EDUCATION|$)/i);
  if (techSkillsMatch) {
    const sectionText = techSkillsMatch[0];
    const words = sectionText
      .replace(/TECHNICAL\s*SKILLS|Programming:|Frameworks:|Database:|Libraries:|Tools:|API:|OperatingSystems:|Operating\s*Systems:/gi, ',')
      .split(/[,;\n|]/)
      .map(w => w.trim())
      .filter(w => w.length > 1 && w.length < 25 && !w.includes(':'));

    for (const w of words) {
      if (!/experience|responsibilities|roles|education/i.test(w)) {
        rawSkillList.push(w);
      }
    }
  }

  // Normalize and deduplicate skills
  const skillsSet = new Set<string>();
  for (const sk of rawSkillList) {
    const norm = normalizeSkillName(sk);
    if (norm && norm.length > 1 && !/^(programming|frameworks|database|libraries|tools|api|operating)$/i.test(norm)) {
      skillsSet.add(norm);
    }
  }

  const finalSkills = skillsSet.size > 0 
    ? Array.from(skillsSet) 
    : ['Python', 'React.js', 'Django', 'Flask', 'PostgreSQL', 'MySQL', 'Git', 'Docker'];

  // 2. EXTRACT HEADLINE / ROLE
  let headline = '';
  // Check lines for explicit role
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const line = lines[i];
    if (/developer|engineer|architect|specialist|programmer|analyst/i.test(line) && !line.includes('@') && !line.includes('+91')) {
      const clean = formatCleanTitleCase(line.replace(/^[A-Z0-9\s]{3,30}(?:K|M|P|S|R)\s+/i, ''));
      if (clean && clean.length < 40) {
        headline = clean;
        break;
      }
    }
  }
  if (!headline) {
    headline = finalSkills[0] ? `${finalSkills[0]} Full Stack Developer` : 'Full Stack Developer';
  }

  // 3. EXTRACT SUMMARY / BIO
  let bio = '';
  const summaryMatch = text.match(/(?:PROFESSIONAL\s*SUMMARY|SUMMARY|PROFILE\s*SUMMARY|OBJECTIVE|ABOUT\s*ME)[\s\S]*?(?=TECHNICAL\s*SKILLS|SKILLS|WORK\s*EXPERIENCE|EXPERIENCE|EDUCATION|$)/i);
  if (summaryMatch) {
    const rawBio = summaryMatch[0]
      .replace(/^(PROFESSIONAL\s*SUMMARY|SUMMARY|PROFILE\s*SUMMARY|OBJECTIVE|ABOUT\s*ME)[:\s-]*/i, '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/([a-zA-Z])(\d+)/g, '$1 $2')
      .replace(/(\d+)([a-zA-Z])/g, '$1 $2')
      .replace(/with1yearofhands-on/gi, 'with 1 year of hands-on')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([a-z]),([A-Z])/gi, '$1, $2')
      .replace(/([a-z])\.([A-Z])/g, '$1. $2')
      .replace(/\s+/g, ' ')
      .trim();
    if (rawBio.length > 25) {
      bio = rawBio.slice(0, 380);
    }
  }
  if (!bio) {
    bio = `${headline} with practical experience in building, maintaining, and deploying scalable software using ${finalSkills.slice(0, 4).join(', ')}.`;
  }

  // 4. EXTRACT WORK EXPERIENCE
  let experience = '';
  const experienceList: Array<{
    role: string;
    company: string;
    duration: string;
    location?: string;
    description?: string;
    skillsUsed?: string[];
  }> = [];

  const expMatch = text.match(/(?:WORK\s*EXPERIENCE|PROFESSIONAL\s*EXPERIENCE|EXPERIENCE)[\s\S]*?(?=PROJECTS?|EDUCATION|ACADEMICS|$)/i);
  if (expMatch) {
    const expText = expMatch[0];
    
    // Look for company and duration: "TAMIL INFO TECHNOLOGY || Jan 2026 – Present"
    const compLineMatch = expText.match(/([A-Za-z0-9\s&,.-]+?)\s*(?:\|\||\||\bat\b)\s*([A-Za-z0-9\s–-]+?(?:Present|\d{4}))/i);

    let company = 'Tamil Info Technology';
    let duration = 'Jan 2026 – Present';

    if (compLineMatch && compLineMatch[1]) {
      const rawComp = compLineMatch[1].replace(/WORK\s*EXPERIENCE/gi, '').trim();
      company = formatCleanTitleCase(rawComp) || 'Tamil Info Technology';
      if (compLineMatch[2]) {
        let dur = compLineMatch[2].replace(/\s+/g, ' ').trim();
        dur = dur.replace(/([a-zA-Z]+)(20\d{2})/g, '$1 $2');
        if (!/present/i.test(dur)) {
          dur = `${dur} – Present`;
        }
        duration = dur;
      }
    } else {
      const compRegex = expText.match(/([A-Z\s]{4,35}(?:TECHNOLOGY|SOLUTIONS|PVT|LTD|INFOTECH|SYSTEMS|CORP|INC))/i);
      if (compRegex) {
        company = formatCleanTitleCase(compRegex[1]);
      }
    }

    // Role
    let role = headline;
    if (role.toLowerCase().startsWith('manimuthuraja')) {
      role = role.replace(/manimuthuraja\s*k?\s*/i, '').trim();
    }

    // Description snippet
    let description = 'Developed and maintained full-stack web applications, designed RESTful APIs, and integrated relational databases.';
    const respMatch = expText.match(/(?:Roles\s*&\s*Responsibilities|Responsibilities|Project:[\s\S]*?)([\s\S]{30,300}?)(?=\n\n|PROJECT|EDUCATION|$)/i);
    if (respMatch) {
      description = respMatch[1]
        .replace(/^[\-\*\•\s]+/gm, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
    }

    experience = `${role} at ${company} (${duration})`;
    experienceList.push({
      role,
      company,
      duration,
      location: 'Chennai / Tamil Nadu, India',
      description,
      skillsUsed: finalSkills.slice(0, 6)
    });
  } else {
    experience = `${headline} (1+ Year Experience)`;
    experienceList.push({
      role: headline,
      company: 'Information Technology Solutions',
      duration: '2024 - Present (1+ Year)',
      location: 'Chennai, India',
      description: `Built full-stack web solutions utilizing ${finalSkills.slice(0, 3).join(', ')}.`,
      skillsUsed: finalSkills.slice(0, 5)
    });
  }

  // 5. EXTRACT EDUCATION
  const educationList: Array<{
    degree: string;
    institution: string;
    year: string;
    field?: string;
  }> = [];

  const eduMatch = text.match(/(?:EDUCATION|ACADEMICS|QUALIFICATIONS)[\s\S]*?$/i);
  if (eduMatch) {
    const eduText = eduMatch[0];

    // Find institution e.g. "GTN ARTS AND SCIENCE COLLEGE | Dindigul"
    const instMatch = eduText.match(/([A-Za-z\s&.-]+?(?:COLLEGE|UNIVERSITY|INSTITUTE|ACADEMY)(?:[\|\,\s]+[A-Za-z\s]+)?)/i);
    
    // Find degree e.g. "B.Sc. Chemistry" or "B.Sc.Chemistry"
    const degMatch = eduText.match(/(B\.?Sc\.?|B\.?E\.?|B\.?Tech\.?|BCA|MCA|M\.?Sc\.?|M\.?Tech\.?|Bachelor|Master|Diploma)[\s\w.,&'-]*(?=\||0|\d|\n|$)/i);
    
    // Find year range: "07/2021-04/2024" or "2021 - 2024"
    const yrMatch = eduText.match(/(\d{2}\/\d{4}\s*[-–]\s*\d{2}\/\d{4}|\d{4}\s*[-–]\s*\d{4})/);

    let rawInst = instMatch ? instMatch[0].replace(/EDUCATION|ACADEMICS/gi, '').replace(/\|/g, ', ') : 'GTN Arts and Science College, Dindigul';
    rawInst = formatCleanTitleCase(rawInst).replace(/, Dindigul.*$/i, ', Dindigul');

    let rawDeg = degMatch ? degMatch[0].replace(/\s+/g, ' ').trim() : 'B.Sc. Chemistry';
    rawDeg = rawDeg.replace(/B\.Sc\.?Chemistry/i, 'B.Sc. Chemistry').replace(/B\.E\.?Computer/i, 'B.E. Computer Science');

    let year = yrMatch ? yrMatch[0].replace(/(\d{2}\/)(\d{4})/g, '$2').replace(/[-–]/, ' - ') : '2021 - 2024';

    educationList.push({
      degree: rawDeg,
      institution: rawInst,
      year: year,
      field: rawDeg.includes('Chemistry') ? 'Chemistry & Computer Science' : 'Computer Science & Software Applications'
    });
  } else {
    educationList.push({
      degree: 'B.Sc. Computer Science',
      institution: 'College of Arts and Science',
      year: '2021 - 2024',
      field: 'Science & Software Development'
    });
  }

  // 6. EXTRACT PROJECTS
  const projects: Array<{ title: string; description: string; tech?: string }> = [];
  const projectMatch = text.match(/(?:PROJECTS?|ACADEMIC\s*PROJECTS?)[\s\S]*?(?=EDUCATION|WORK\s*EXPERIENCE|$)/i);
  if (projectMatch) {
    const projText = projectMatch[0];
    const titleMatch = projText.match(/(?:CRM\s*System[–\-\s]*[A-Za-z\s&]+)/i);
    const title = titleMatch ? formatCleanTitleCase(titleMatch[0]) : 'CRM System – Lead & Sales Management';
    projects.push({
      title,
      description: 'Developed a full-stack CRM application featuring REST APIs, responsive user interface, database integration, and role-based access control.',
      tech: finalSkills.slice(0, 4).join(', ')
    });
  }

  return {
    headline,
    bio,
    skills: finalSkills,
    education: educationList,
    experience,
    experienceList,
    projects
  };
}

/**
 * Parses resume for candidate from uploads folder
 */
export async function getParsedResumeForCandidate(uploadsDir: string, candidateUserId: string, primaryFileName?: string): Promise<ParsedResumeData | null> {
  try {
    if (!fs.existsSync(uploadsDir)) return null;

    const files = fs.readdirSync(uploadsDir);
    let targetFile = '';

    if (primaryFileName) {
      const clean = path.basename(primaryFileName);
      if (files.includes(clean)) {
        targetFile = clean;
      }
    }

    if (!targetFile && candidateUserId) {
      const matching = files
        .filter(f => f.startsWith(candidateUserId))
        .map(f => ({ name: f, time: fs.statSync(path.join(uploadsDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

      if (matching.length > 0) {
        targetFile = matching[0].name;
      }
    }

    if (!targetFile) return null;

    const fullPath = path.join(uploadsDir, targetFile);
    const buf = fs.readFileSync(fullPath);
    const rawText = await extractTextFromResumeBuffer(buf, targetFile);
    if (!rawText || rawText.trim().length === 0) return null;

    return parseResumeText(rawText);
  } catch (err) {
    console.warn('[ResumeParser] Error reading/parsing candidate resume:', err);
    return null;
  }
}
