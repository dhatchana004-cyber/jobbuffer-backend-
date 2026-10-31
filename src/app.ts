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
import { errorHandler } from './middleware/errorHandler';

import path from 'path';
import fs from 'fs';

const app = express();

app.set('trust proxy', 1);

// Security Middleware - allow cross-origin resource access for PDF previews & downloads
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: '*' }));
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
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dedicated Resume Preview & Download Handler
app.get([
  '/api/resumes/:filename', 
  '/api/recruiter/resumes/:filename',
  '/api/candidates/resume/:filename'
], (req: Request, res: Response) => {
  try {
    const rawParam = req.params.filename;
    const rawFilename = Array.isArray(rawParam) ? rawParam[0] : (rawParam || '');
    const download = req.query.download === 'true';

    // Decode URL components
    const filename = decodeURIComponent(String(rawFilename));
    const directPath = path.join(uploadsDir, filename);

    if (fs.existsSync(directPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${filename}"`
      );
      return res.sendFile(directPath);
    }

    // Case-insensitive or partial name fallback
    const availableFiles = fs.readdirSync(uploadsDir);
    const matched = availableFiles.find(
      f => f.toLowerCase() === filename.toLowerCase() ||
           f.toLowerCase().includes(filename.toLowerCase().replace(/_resume\.pdf$/i, ''))
    );

    if (matched) {
      const matchedPath = path.join(uploadsDir, matched);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${filename.endsWith('.pdf') ? filename : filename + '.pdf'}"`
      );
      return res.sendFile(matchedPath);
    }

    // Default sample PDF if specific file not present
    const anyPdf = availableFiles.find(f => f.toLowerCase().endsWith('.pdf'));
    if (anyPdf) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${filename}"`
      );
      return res.sendFile(path.join(uploadsDir, anyPdf));
    }

    return res.status(404).json({ message: 'Resume document not found' });
  } catch (err: any) {
    console.error('Error serving resume:', err);
    return res.status(500).json({ message: 'Error retrieving resume' });
  }
});

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

