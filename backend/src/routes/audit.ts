import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { AuditLog } from '../models/AuditLog';
import { getLiveStats } from '../services/EventBus';

const router = Router();

/**
 * GET /api/audit — paginated immutable audit trail (admin only).
 */
router.get('/', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 25);
    const filter: Record<string, unknown> = {};
    if (req.query.eventType) filter.eventType = req.query.eventType;
    if (req.query.entityId) filter.entityId = req.query.entityId;

    const [entries, totalCount] = await Promise.all([
      AuditLog.find(filter)
        .sort({ occurredAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('actor', 'firstName lastName email role')
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { entries, totalCount, totalPages: Math.ceil(totalCount / limit), currentPage: page },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch audit log' });
  }
});

/**
 * GET /api/audit/stats — today's live event counters from the analytics consumer (admin only).
 */
router.get('/stats', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const stats = await getLiveStats(req.query.day as string | undefined);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch live stats' });
  }
});

export default router;
