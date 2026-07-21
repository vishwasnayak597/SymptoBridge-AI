import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { AuthService } from '../services/AuthService';
import { warmUpMlService } from '../services/TriageService';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema } from '../../../shared/schemas';
import { ApiResponse } from '../../../shared/types';
import User from '../models/User'; // Added import for User model

const router = express.Router();

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const AUTH_RATE_LIMIT = process.env.NODE_ENV === 'production' ? 5 : 10000; // 5 in prod, 10000 in dev
const PASSWORD_RESET_RATE_LIMIT = process.env.NODE_ENV === 'production' ? 3 : 10000; // 3 in prod, 10000 in dev

const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW,
  max: AUTH_RATE_LIMIT,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for development entirely
  skip: (req) => process.env.NODE_ENV === 'development'
});

const passwordResetLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW,
  max: PASSWORD_RESET_RATE_LIMIT,
  message: {
    success: false,
    error: 'Too many password reset attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for development entirely
  skip: (req) => process.env.NODE_ENV === 'development'
});

// Registration/login bodies are validated by the shared zod schemas
// (shared/schemas.ts) — the same contracts the frontend forms use.

const validatePasswordReset = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required')
];

const validateNewPassword = [
  body('password')
    .isLength({ min: 7 })
    .withMessage('Password must be at least 7 characters long'),
  body('token')
    .notEmpty()
    .withMessage('Reset token is required')
];

const validateChangePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 7 })
    .withMessage('New password must be at least 7 characters long')
];

/**
 * Register new user
 */
router.post('/register', authLimiter, validate(registerSchema), async (req: Request, res: Response<ApiResponse>) => {
  try {
    // req.body is the parsed RegisterInput: trimmed, coerced, unknown keys
    // (e.g. confirmPassword) already stripped by the schema.
    const result = await AuthService.register(req.body);
    
    if (result.success && result.data) {
      res.cookie('refreshToken', result.data.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      
      return res.status(201).json({
        success: true,
        data: {
          user: result.data.user,
          accessToken: result.data.tokens.accessToken
        },
        message: result.message
      });
    }
    
    res.status(400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Registration failed. Please try again.'
    });
  }
});

/**
 * Login user
 */
router.post('/login', authLimiter, validate(loginSchema), async (req: Request, res: Response<ApiResponse>) => {
  try {
    const result = await AuthService.login(req.body);

    if (result.success && result.data) {
      // Wake the ML service now so triage is warm by the time the patient gets
      // there. Fire-and-forget — must not delay or fail the login response.
      warmUpMlService();

      res.cookie('refreshToken', result.data.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      
      return res.json({
        success: true,
        data: {
          user: result.data.user,
          accessToken: result.data.tokens.accessToken
        },
        message: result.message
      });
    }
    
    const statusCode = result.error?.includes('locked') ? 423 : 
                      result.error?.includes('deactivated') ? 403 : 401;
    
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
});

/**
 * Refresh access token
 */
router.post('/refresh', async (req: Request, res: Response<ApiResponse>) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token is required'
      });
    }
    
    const result = await AuthService.refreshToken(refreshToken);
    
    if (result.success && result.data) {
      res.cookie('refreshToken', result.data.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      
      return res.json({
        success: true,
        data: {
          accessToken: result.data.accessToken
        },
        message: result.message
      });
    }
    
    res.clearCookie('refreshToken');
    res.status(401).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Token refresh failed. Please try again.'
    });
  }
});

/**
 * Logout user
 */
router.post('/logout', authenticate, async (req: Request, res: Response<ApiResponse>) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
    if (refreshToken && req.user) {
      await AuthService.logout(req.user._id.toString(), refreshToken);
    }
    
    res.clearCookie('refreshToken');
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Logout failed. Please try again.'
    });
  }
});

/**
 * Logout from all devices
 */
router.post('/logout-all', authenticate, async (req: Request, res: Response<ApiResponse>) => {
  try {
    if (req.user) {
      await AuthService.logoutAll(req.user._id.toString());
    }
    
    res.clearCookie('refreshToken');
    res.json({
      success: true,
      message: 'Logged out from all devices'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Logout failed. Please try again.'
    });
  }
});

/**
 * Verify email
 */
router.post('/verify-email/:token', async (req: Request, res: Response<ApiResponse>) => {
  try {
    const result = await AuthService.verifyEmail(req.params.token);
    const statusCode = result.success ? 200 : 400;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Email verification failed. Please try again.'
    });
  }
});

/**
 * Resend email verification
 */
router.post('/resend-verification', authLimiter, validatePasswordReset, async (req: Request, res: Response<ApiResponse>) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        data: errors.array()
      });
    }

    const result = await AuthService.resendVerificationEmail(req.body.email);
    const statusCode = result.success ? 200 : 400;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to resend verification email. Please try again.'
    });
  }
});

/**
 * Request password reset
 */
router.post('/forgot-password', passwordResetLimiter, validatePasswordReset, async (req: Request, res: Response<ApiResponse>) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        data: errors.array()
      });
    }
    
    const result = await AuthService.requestPasswordReset(req.body.email);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Password reset request failed. Please try again.'
    });
  }
});

/**
 * Reset password
 */
router.post('/reset-password', validateNewPassword, async (req: Request, res: Response<ApiResponse>) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        data: errors.array()
      });
    }
    
    const result = await AuthService.resetPassword(req.body.token, req.body.password);
    const statusCode = result.success ? 200 : 400;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Password reset failed. Please try again.'
    });
  }
});

/**
 * Change password
 */
router.post('/change-password', authenticate, validateChangePassword, async (req: Request, res: Response<ApiResponse>) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        data: errors.array()
      });
    }
    
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const result = await AuthService.changePassword(
      req.user._id.toString(),
      req.body.currentPassword,
      req.body.newPassword
    );
    
    const statusCode = result.success ? 200 : 400;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Password change failed. Please try again.'
    });
  }
});

/**
 * Get current user profile
 */
router.get('/me', authenticate, async (req: Request, res: Response<ApiResponse>) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    res.json({
      success: true,
      data: req.user.toUserObject(),
      message: 'User profile retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user profile'
    });
  }
});

export default router; 