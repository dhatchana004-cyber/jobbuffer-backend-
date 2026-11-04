import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = (process.env.JWT_SECRET as string) || 'fallback-secret-key-change-in-production';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    email: string;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication required. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    req.user = {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email,
    };

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const userRole = (req.user.role || '').toUpperCase();
    const allowedRoles = roles.map(r => r.toUpperCase());

    // 1. ADMIN has universal clearance across all recruiter and platform resources
    if (userRole === 'ADMIN') {
      return next();
    }

    // 2. In JoBuffer, any authenticated user navigating recruiter routes has full recruiter access
    if (allowedRoles.includes('RECRUITER')) {
      return next();
    }

    // 3. Direct role match
    if (allowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({ 
      message: 'Forbidden. You do not have permission to access this resource.' 
    });
  };
};
