import mongoose, { Schema, Document } from 'mongoose';

/**
 * Stored response for an Idempotency-Key, so retrying a write (double-click,
 * network retry, flaky mobile connection) replays the original outcome
 * instead of double-booking / double-charging. Records expire after 24h.
 */
export interface IIdempotencyKey extends Document {
  key: string;               // scope:userId:client-key
  statusCode?: number;
  responseBody?: unknown;
  createdAt: Date;
}

const idempotencyKeySchema = new Schema<IIdempotencyKey>({
  key: { type: String, required: true, unique: true },
  statusCode: { type: Number },
  responseBody: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 },
});

export const IdempotencyKey = mongoose.model<IIdempotencyKey>('IdempotencyKey', idempotencyKeySchema);
