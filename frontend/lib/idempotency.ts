/**
 * Client half of the Idempotency-Key contract (see backend middleware).
 * Generate one key per logical operation — NOT per HTTP attempt — and send it
 * on the write; regenerate only after the operation succeeds.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
