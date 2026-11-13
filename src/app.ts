import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/authRoutes';
import candidateRoutes from './routes/candidateRoutes';
import recruiterRoutes from './routes/recruiterRoutes';
import adminRoutes from './routes/adminRoutes';
import jobRoutes from './routes/jobRoutes';
import applicationRoutes from './routes/applicationRoutes';
import aiRoutes from './routes/aiRoutes';
import paymentRoutes from './routes/paymentRoutes';
import { errorHandler } from './middleware/errorHandler';

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const app = express();

app.set('trust proxy', 1);

// Comprehensive CORS & Preflight Middleware (Live Production & Local Dev)
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = (req.headers.origin as string) || '*';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma, X-Access-Token'
  );
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, X-Total-Count');

  // Answer preflight OPTIONS requests immediately
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Cache-Control', 'Pragma', 'X-Access-Token']
}));

// Preflight handler for all routes
app.options('*', (req: Request, res: Response) => {
  res.status(200).end();
});

// Security Middleware - allow cross-origin resource access for PDF previews & downloads
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads serving
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));
app.use('/api/uploads', express.static(uploadsDir));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', apiLimiter);

// Health Check
app.get(['/health', '/api/health', '/api/v1/health'], (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dedicated Resume Preview & Download Handler Function
const serveResumeDocument = async (req: Request, res: Response) => {
  try {
    console.log('serveResumeDocument called with:', req.originalUrl, req.path, req.params);
    const rawParam = req.params?.filename || req.params?.[0] || req.path.replace(/^\//, '').split('/').pop();
    const rawFilename = Array.isArray(rawParam) ? rawParam[0] : (rawParam || '');
    const download = req.query.download === 'true';

    // Decode URL components and strip directory traversal
    let filename = decodeURIComponent(String(rawFilename)).replace(/^.*[\\\/]/, '');
    if (!filename || filename === 'uploads' || filename === 'resumes') {
      filename = 'Resume.pdf';
    }
    const directPath = path.join(uploadsDir, filename);

    // Determine target file to send
    let targetPath = '';
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      targetPath = directPath;
    } else {
      // Case-insensitive or partial name fallback
      const availableFiles = fs.readdirSync(uploadsDir).filter(f => !fs.statSync(path.join(uploadsDir, f)).isDirectory());
      const cleanTarget = filename.toLowerCase().replace(/(_resume)?\.(pdf|docx?)$/i, '');
      const matched = availableFiles.find(
        f => f.toLowerCase() === filename.toLowerCase() ||
             (cleanTarget.length >= 3 && f.toLowerCase().includes(cleanTarget)) ||
             (cleanTarget.length >= 4 && cleanTarget.includes(f.toLowerCase().replace(/(_resume)?\.(pdf|docx?)$/i, '')))
      );

      if (matched) {
        targetPath = path.join(uploadsDir, matched);
      } else {
        const anyPdf = availableFiles.find(f => f.toLowerCase().endsWith('.pdf'));
        if (anyPdf) {
          targetPath = path.join(uploadsDir, anyPdf);
        }
      }
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ message: 'Resume document not found' });
    }

    // Determine human-friendly download name
    let cleanDisplayName = (req.query.name as string) || (req.query.candidateName as string) || (req.query.filename as string);
    if (!cleanDisplayName) {
      try {
        const resumeRecord = await prisma.resume.findFirst({
          where: {
            OR: [
              { fileUrl: { contains: filename } },
              { fileName: { contains: filename } }
            ]
          },
          include: { candidate: { include: { user: true } } }
        });
        if (resumeRecord) {
          cleanDisplayName = resumeRecord.fileName || `${resumeRecord.candidate.user.name || 'Candidate'}_Resume.pdf`;
        }
      } catch {}
    }
    if (!cleanDisplayName) {
      cleanDisplayName = filename;
    }
    cleanDisplayName = decodeURIComponent(cleanDisplayName).replace(/%20/g, ' ').trim();
    if (!cleanDisplayName.toLowerCase().endsWith('.pdf') && !cleanDisplayName.toLowerCase().endsWith('.docx')) {
      cleanDisplayName += '.pdf';
    }

    const isDocx = targetPath.toLowerCase().endsWith('.docx');
    const isDoc = targetPath.toLowerCase().endsWith('.doc');
    const contentType = isDocx 
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : isDoc 
        ? 'application/msword' 
        : 'application/pdf';

    const safeAsciiName = cleanDisplayName.replace(/[^\x20-\x7E]/g, '_');

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${safeAsciiName}"; filename*="UTF-8''${encodeURIComponent(cleanDisplayName)}"`
    );
    res.setHeader('Cache-Control', 'public, max-age=3600');

    return res.sendFile(targetPath);
  } catch (err: any) {
    console.error('Error serving resume:', err);
    return res.status(500).json({ message: 'Error retrieving resume' });
  }
};

// Route mappings for resume viewing & downloading
const resumeRoutes = [
  '/uploads/:filename',
  '/api/uploads/:filename',
  '/api/v1/uploads/:filename',
  '/resumes/:filename',
  '/api/resumes/:filename', 
  '/api/v1/api/resumes/:filename',
  '/api/v1/resumes/:filename',
  '/api/admin/resumes/:filename',
  '/api/v1/admin/resumes/:filename',
  '/api/recruiter/resumes/:filename',
  '/api/v1/recruiter/resumes/:filename',
  '/api/candidates/resume/:filename',
  '/api/v1/candidates/resume/:filename'
];

resumeRoutes.forEach(r => {
  app.get(r, serveResumeDocument);
});

// Fallback for any other /uploads/* or /resumes/* requests
app.use('/uploads', serveResumeDocument);
app.use('/api/uploads', serveResumeDocument);
app.use('/resumes', serveResumeDocument);
app.use('/api/resumes', serveResumeDocument);

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/v1/candidates', candidateRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/v1/users', candidateRoutes);
app.use('/api/users', candidateRoutes);
app.use('/api/v1/recruiters', recruiterRoutes);
app.use('/api/recruiters', recruiterRoutes);
app.use('/api/v1/recruiter', recruiterRoutes);
app.use('/api/recruiter', recruiterRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/v1/applications', applicationRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/v1/notifications', candidateRoutes);
app.use('/api/notifications', candidateRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/payments', paymentRoutes);


// 404 Handler
app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error Handler
app.use(errorHandler);
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});

export default app;

