import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  register,
  login,
  logout,
  refreshToken,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js';
import { verifyToken } from '../middleware/auth.js';
import {
  validateRegistrationBody,
  validateLoginBody,
  validateProfileUpdate,
  validatePasswordChange,
  validateResetPassword,
  validateForgotPassword,
  validate,
  schemas,
} from '../middleware/validation.js';

const router = Router();

const isDev = process.env.NODE_ENV !== 'production';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 200 : 20,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Too many password reset requests. Please try again later.',
  },
});

router.post('/register', authLimiter, validateRegistrationBody, register);
router.post('/login', authLimiter, validateLoginBody, login);
router.post('/refresh-token', authLimiter, validate(schemas.refreshToken), refreshToken);
router.post('/forgot-password', passwordResetLimiter, validateForgotPassword, forgotPassword);
router.post('/reset-password', passwordResetLimiter, validateResetPassword, resetPassword);

router.post('/logout', verifyToken, logout);
router.get('/me', verifyToken, getMe);
router.put('/profile', verifyToken, validateProfileUpdate, updateProfile);
router.put('/change-password', verifyToken, validatePasswordChange, changePassword);

export default router;
