import { Router } from 'express';
import { 
  register, 
  login, 
  getMe, 
  updateMe, 
  verifyOtp, 
  resendOtp,
  forgotPassword,
  resetPassword
} from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, updateMe);

export default router;
