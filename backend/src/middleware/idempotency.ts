import { Request, Response, NextFunction } from 'express';
import { IdempotencyKey } from '../models/IdempotencyKey';

/**
 * Idempotent writes via the `Idempotency-Key` header (Stripe's pattern).
 *
 * The client sends a unique key per logical operation (not per HTTP attempt).
 * First attempt: we reserve the key (unique index wins any race), run the
 * handler, and store the JSON response. Retries with the same key get the
 * stored response back — with an `Idempotency-Replayed: true` header — so a
 * double-click or network retry can never create two bookings or charges.
 *
 * Opt-in per route: requests without the header behave normally.
 */
export function idempotent(scope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientKey = req.header('Idempotency-Key');
    if (!clientKey) return next();

    const userId = (req as any).user?._id?.toString() ?? 'anon';
    const key = `${scope}:${userId}:${clientKey}`;

    try {
      const existing = await IdempotencyKey.findOne({ key });
      if (existing) {
        if (existing.statusCode !== undefined) {
          res.set('Idempotency-Replayed', 'true');
          return res.status(existing.statusCode).json(existing.responseBody);
        }
        // Reserved but no stored response yet: the first attempt is still running.
        return res.status(409).json({
          success: false,
          error: 'A request with this Idempotency-Key is already in progress',
        });
      }

      await IdempotencyKey.create({ key });
    } catch (error: any) {
      if (error?.code === 11000) {
        // Lost the reservation race to a concurrent attempt.
        return res.status(409).json({
          success: false,
          error: 'A request with this Idempotency-Key is already in progress',
        });
      }
      // Idempotency store unavailable — degrade to non-idempotent rather than
      // failing the user's action.
      return next();
    }

    // Capture the handler's JSON response. Successes are persisted for replay;
    // failures release the key so the user can fix their input and retry —
    // otherwise a stored 400 would be replayed at them forever.
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      const settle = succeeded
        ? IdempotencyKey.updateOne({ key }, { $set: { statusCode: res.statusCode, responseBody: body } })
        : IdempotencyKey.deleteOne({ key });
      settle.catch(() => {});
      return originalJson(body);
    }) as Response['json'];

    next();
  };
}
