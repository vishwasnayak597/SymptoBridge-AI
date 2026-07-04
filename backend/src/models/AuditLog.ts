import mongoose, { Schema, Document } from 'mongoose';

/**
 * Immutable audit trail of domain events, written by the event-bus audit consumer.
 * Healthcare systems are expected to keep a who-did-what-when record; this is ours.
 */
export interface IAuditLog extends Document {
  eventType: string;
  actor?: mongoose.Types.ObjectId;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  occurredAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    eventType: { type: String, required: true, index: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    entityType: String,
    entityId: { type: String, index: true },
    payload: Schema.Types.Mixed,
    occurredAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: false, versionKey: false }
);

AuditLogSchema.index({ occurredAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
