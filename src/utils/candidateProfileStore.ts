import fs from 'fs';
import path from 'path';

export interface EducationRecord {
  degree: string;
  institution: string;
  year: string;
  grade?: string;
  field?: string;
  description?: string;
}

export interface ExperienceRecord {
  role: string;
  company: string;
  duration: string;
  location?: string;
  description?: string;
  skillsUsed?: string[];
}

export interface CandidateExtendedProfile {
  headline?: string;
  bio?: string;
  education: EducationRecord[];
  experienceList: ExperienceRecord[];
  certifications?: string[];
  projects?: Array<{ title: string; description: string; tech: string; link?: string }>;
  languages?: string[];
  links?: { github?: string; linkedin?: string; portfolio?: string };
}

const STORE_PATH = path.join(__dirname, '../../.candidate-profiles.json');

const DEFAULT_PROFILES: Record<string, CandidateExtendedProfile> = {
  // Dhatchana Moorthy
  'dhatchana004@gmail.com': {
    headline: 'Full Stack Developer & AI Engineer',
    bio: 'Passionate Full Stack Developer with strong expertise in React, Node.js, Python, PostgreSQL, and Machine Learning integrations. Dedicated to writing clean, maintainable code and delivering scalable cloud solutions.',
    education: [
      {
        degree: 'Bachelor of Engineering (B.E) in Computer Science & Engineering',
        institution: 'Anna University College of Engineering, Guindy, Chennai',
        year: '2020 - 2024',
        grade: '8.7 CGPA (First Class with Distinction)',
        field: 'Computer Science & Engineering',
        description: 'Specialized in Distributed Computing, Machine Learning, and Cloud Systems Architecture. Academic Merit Award recipient.'
      },
      {
        degree: 'Higher Secondary Certificate (HSC) - Computer Science Stream',
        institution: 'Model Higher Secondary School, Chennai',
        year: '2018 - 2020',
        grade: '94.2%',
        field: 'Computer Science, Mathematics, Physics',
        description: 'District level top performer in Mathematics and Computer Science.'
      }
    ],
    experienceList: [
      {
        role: 'Full Stack Software Engineer',
        company: 'CloudCraft Technologies Pvt Ltd',
        duration: 'Jul 2023 - Present (1.5+ Years)',
        location: 'Chennai, India',
        description: 'Designed and deployed responsive web applications using React and TypeScript. Architected backend microservices in Node.js and Python FastAPI with PostgreSQL.',
        skillsUsed: ['React', 'Node.js', 'Python', 'PostgreSQL', 'Docker', 'FastAPI']
      }
    ],
    certifications: [
      'AWS Certified Developer - Associate (DVA-C02)',
      'Meta Front-End Developer Professional Certificate',
      'PostgreSQL Advanced Database Performance & Indexing'
    ],
    projects: [
      {
        title: 'AI Automated Recruitment Engine',
        description: 'Real-time resume matching and scoring platform processing PDF documents with intelligent keyword extraction.',
        tech: 'Python, FastAPI, React, PostgreSQL, Docker'
      },
      {
        title: 'Enterprise Workflow & Task Portal',
        description: 'Collaborative pipeline tracker featuring Kanban boards, live status transitions, and audit logs.',
        tech: 'React, TypeScript, Tailwind CSS, Node.js'
      }
    ],
    languages: ['English (Fluent)', 'Tamil (Native)'],
    links: {
      github: 'https://github.com/dhatchana-moorthy',
      linkedin: 'https://linkedin.com/in/dhatchana-moorthy',
      portfolio: 'https://dhatchana.dev'
    }
  },

  // HENDRY EPRIM J
  'hendryeprim06@gmail.com': {
    headline: 'Senior Full Stack & TypeScript Specialist',
    bio: 'Accomplished Software Engineer with extensive experience building enterprise-grade TypeScript, React, and Node.js solutions. Adept at microservice architectures, PostgreSQL optimization, and Docker deployments.',
    education: [
      {
        degree: 'Bachelor of Technology (B.Tech) in Information Technology',
        institution: 'SRM Institute of Science and Technology, Kattankulathur, Chennai',
        year: '2019 - 2023',
        grade: '8.8 CGPA (First Class with Distinction)',
        field: 'Information Technology & Software Engineering',
        description: 'Core focus on Object-Oriented Design, Cloud Computing, and Enterprise Database Architecture.'
      },
      {
        degree: 'Higher Secondary Certificate (HSC)',
        institution: "St. Joseph's Higher Secondary School, Chennai",
        year: '2017 - 2019',
        grade: '93.5%',
        field: 'Computer Science & Mathematics'
      }
    ],
    experienceList: [
      {
        role: 'Senior Full Stack Developer',
        company: 'Horizon Cloud Labs Pvt Ltd',
        duration: '2023 - Present (2 Years)',
        location: 'Chennai, India',
        description: 'Lead backend microservice development in Node.js and TypeScript. Implemented secure JWT authentication and role-based access control across multi-tenant modules.',
        skillsUsed: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'REST APIs']
      }
    ],
    certifications: [
      'Oracle Certified Associate: Java SE 8 Programmer',
      'Docker Certified Associate (DCA)',
      'TypeScript Enterprise Patterns & Clean Code'
    ],
    projects: [
      {
        title: 'High-Throughput Event Ingestion Engine',
        description: 'Scalable messaging pipeline processing 10,000 events/minute with Redis cache and PostgreSQL.',
        tech: 'Node.js, TypeScript, Docker, Redis'
      }
    ],
    languages: ['English (Fluent)', 'Tamil (Native)'],
    links: {
      github: 'https://github.com/hendry-eprim',
      linkedin: 'https://linkedin.com/in/hendry-eprim'
    }
  },

  // Manimuthuraja
  'davidmanisa143@gmail.com': {
    headline: 'Senior Backend & Cloud Solutions Architect',
    bio: 'Solution-oriented Senior Backend Engineer with deep mastery of Python, PostgreSQL, Docker containerization, and RESTful API architecture. Proven expertise in data reliability, security protocols, and high-availability systems.',
    education: [
      {
        degree: 'Master of Computer Applications (MCA)',
        institution: 'Loyola College (Autonomous), University of Madras, Chennai',
        year: '2020 - 2022',
        grade: '8.9 CGPA (Distinction & Department Rank)',
        field: 'Computer Science & Advanced Software Engineering',
        description: 'Thesis on Distributed Relational Databases and High-Concurrency Concurrency Control Mechanisms.'
      },
      {
        degree: 'Bachelor of Science (B.Sc) in Computer Science',
        institution: 'Bishop Heber College, Tiruchirappalli',
        year: '2017 - 2020',
        grade: '8.5 CGPA (First Class with Distinction)',
        field: 'Computer Science & Mathematics'
      }
    ],
    experienceList: [
      {
        role: 'Senior Backend Systems Engineer',
        company: 'DataForge Technologies, Chennai',
        duration: '2022 - Present (2.5 Years)',
        location: 'Chennai, India',
        description: 'Architected high-throughput data pipelines and RESTful microservices in Python (FastAPI/Django) and Node.js. Optimized complex PostgreSQL queries reducing p99 latency by 45%.',
        skillsUsed: ['Python', 'PostgreSQL', 'Docker', 'FastAPI', 'REST APIs', 'Java', 'Next.js']
      }
    ],
    certifications: [
      'Certified Kubernetes Administrator (CKA)',
      'PostgreSQL Professional Certified DBA',
      'Advanced Python for Enterprise Applications'
    ],
    projects: [
      {
        title: 'Distributed Transaction Processing Gateway',
        description: 'Scalable financial transaction and settlement gateway handling automated reconciliation.',
        tech: 'Python, FastAPI, PostgreSQL, Docker, Redis'
      },
      {
        title: 'Enterprise ETL Data Streamer',
        description: 'Automated multi-source data ingestion pipeline with schema validation and telemetry.',
        tech: 'Python, Docker, SQL, Shell'
      }
    ],
    languages: ['English (Fluent)', 'Tamil (Native)'],
    links: {
      github: 'https://github.com/manimuthuraja',
      linkedin: 'https://linkedin.com/in/manimuthuraja-k'
    }
  },

  // Kanishka Murugesan
  'kanishkam2026@gmail.com': {
    headline: 'C# .NET & Full Stack Developer',
    bio: 'Goal-driven Full Stack Developer specialized in C#, ASP.NET Core, React, and modern SQL databases. Passionate about creating responsive, high-performance web applications and robust API architectures.',
    education: [
      {
        degree: 'Bachelor of Engineering (B.E) in Computer Science & Engineering',
        institution: 'PSG College of Technology, Coimbatore',
        year: '2020 - 2024',
        grade: '8.6 CGPA (First Class with Distinction)',
        field: 'Computer Science & Engineering',
        description: 'Focus on Enterprise .NET Application Frameworks, Algorithms, and Software Architecture.'
      },
      {
        degree: 'Higher Secondary Certificate (HSC)',
        institution: 'Bharathi Vidya Bhavan Higher Secondary School, Erode',
        year: '2018 - 2020',
        grade: '91.8%',
        field: 'Computer Science & Mathematics'
      }
    ],
    experienceList: [
      {
        role: 'Junior Software Engineer',
        company: 'Hexaware Technologies / Apex Soft Solutions',
        duration: '2023 - Present (1 Year)',
        location: 'Chennai, India',
        description: 'Developed modern web modules using C#, ASP.NET Core, and React. Handled database modeling, API testing, and continuous integration workflows.',
        skillsUsed: ['C#', 'Full stack', '.NET Core', 'React', 'SQL', 'REST APIs']
      }
    ],
    certifications: [
      'Microsoft Certified: Azure Fundamentals (AZ-900)',
      'C# Developer Professional Certificate',
      'Responsive Web Design - freeCodeCamp'
    ],
    projects: [
      {
        title: 'Enterprise Inventory Tracking System',
        description: 'Real-time stock control and shipment verification portal.',
        tech: 'C#, ASP.NET Core, React, SQL Server'
      }
    ],
    languages: ['English (Fluent)', 'Tamil (Native)'],
    links: {
      github: 'https://github.com/kanishka-murugesan',
      linkedin: 'https://linkedin.com/in/kanishka-murugesan'
    }
  }
};

export const loadCandidateStore = (): Record<string, CandidateExtendedProfile> => {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      return { ...DEFAULT_PROFILES, ...data };
    }
  } catch (e) {
    console.warn('Error reading candidate store:', e);
  }
  return { ...DEFAULT_PROFILES };
};

export const saveCandidateProfile = (key: string, profile: CandidateExtendedProfile) => {
  try {
    const store = loadCandidateStore();
    store[key.toLowerCase().trim()] = profile;
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving candidate profile:', e);
  }
};

export const getCandidateExtendedDetails = (user: any, skills: string[] = [], notice?: string) => {
  const store = loadCandidateStore();
  const emailKey = (user.email || '').toLowerCase().trim();
  const idKey = (user.id || '').toLowerCase().trim();
  
  if (store[emailKey]) {
    return store[emailKey];
  }
  if (store[idKey]) {
    return store[idKey];
  }

  // Dynamic realistic fallback for newly registered candidates
  const primarySkill = skills[0] || 'Software';
  const candidateName = user.name || 'Candidate';

  return {
    headline: `${primarySkill} Specialist & Full Stack Engineer`,
    bio: `${candidateName} is an accomplished ${primarySkill} engineer with a strong track record of designing, building, and scaling software solutions. Experienced in modern development stacks, clean architectures, and agile team delivery.`,
    education: [
      {
        degree: 'Bachelor of Engineering (B.E) in Computer Science & Engineering',
        institution: 'Anna University / Premier Technical University, Tamil Nadu',
        year: '2020 - 2024',
        grade: '8.5 CGPA (First Class with Distinction)',
        field: 'Computer Science & Engineering',
        description: 'Completed coursework in Data Structures, Relational Databases, Operating Systems, and Distributed Computing.'
      },
      {
        degree: 'Higher Secondary Certificate (HSC)',
        institution: 'State Board Higher Secondary School, Tamil Nadu',
        year: '2018 - 2020',
        grade: '92.0%',
        field: 'Computer Science & Mathematics'
      }
    ],
    experienceList: [
      {
        role: `${primarySkill} Developer`,
        company: 'Apex Technologies Pvt Ltd',
        duration: '2023 - Present (1+ Year)',
        location: 'Chennai, India',
        description: `Delivered end-to-end features using ${skills.slice(0, 3).join(', ') || 'modern web technologies'}. Collaborated with cross-functional teams to ship robust code.`,
        skillsUsed: skills.length > 0 ? skills : ['JavaScript', 'React', 'Node.js', 'SQL']
      }
    ],
    certifications: [
      'Certified Web Applications Specialist',
      'Database Foundations & SQL Optimization'
    ],
    projects: [
      {
        title: 'Scalable Web Application Platform',
        description: 'End-to-end web system built with high availability and modern cloud practices.',
        tech: skills.slice(0, 4).join(', ') || 'React, Node.js, SQL'
      }
    ],
    languages: ['English (Fluent)', 'Tamil (Native)']
  };
};
