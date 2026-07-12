import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Request-body validation against a shared zod schema (see shared/schemas.ts).
 *
 * On success req.body is REPLACED with the parsed value, so handlers receive
 * trimmed/coerced data with unknown keys stripped — never the raw payload.
 * On failure: 400 with per-field messages, same envelope as other API errors.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => issue.message)
        .join(', ');
      return res.status(400).json({ success: false, error: message });
    }
    req.body = result.data;
    next();
  };
}
