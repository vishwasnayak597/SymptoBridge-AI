import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { ApiTokenService } from '../services/ApiTokenService';
import { API_TOKEN_SCOPES } from '../models/ApiToken';

/**
 * Personal access tokens for connecting an AI assistant over MCP (see mcp/server.ts).
 * Managed with the normal login session; the MCP endpoint itself accepts only these
 * tokens, never a session JWT.
 */
const router = Router();

router.use(authenticate, (req: Request, res: Response, next) => {
  if (req.user!.role !== 'patient') {
    return res.status(403).json({ success: false, error: 'Only patient accounts can connect an assistant.' });
  }
  next();
});

router.get('/', async (req: Request, res: Response) => {
  const tokens = await ApiTokenService.list(req.user!._id.toString());
  res.json({ success: true, data: tokens });
});

router.post(
  '/',
  [
    body('name').isString().trim().isLength({ min: 1, max: 60 }).withMessage('Give the connection a name'),
    body('scopes').optional().isArray({ min: 1 }),
    body('scopes.*').isIn([...API_TOKEN_SCOPES]),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array().map((e) => e.msg).join(', ') });
    }
    try {
      const { token, record } = await ApiTokenService.create(
        req.user!._id.toString(),
        req.body.name,
        req.body.scopes
      );
      // The secret is in this response and nowhere else, ever.
      res.status(201).json({
        success: true,
        data: {
          token,
          id: record._id,
          name: record.name,
          prefix: record.prefix,
          scopes: record.scopes,
          expiresAt: record.expiresAt,
        },
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Could not create token' });
    }
  }
);

router.delete('/:id', async (req: Request, res: Response) => {
  const revoked = await ApiTokenService.revoke(req.user!._id.toString(), req.params.id);
  if (!revoked) return res.status(404).json({ success: false, error: 'Token not found' });
  res.json({ success: true, message: 'Access revoked' });
});

export default router;
