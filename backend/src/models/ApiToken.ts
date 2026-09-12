import mongoose, { Schema, Document } from 'mongoose';

/** What an external AI client connected with this token may do. */
export const API_TOKEN_SCOPES = ['doctors:read', 'appointments:read', 'booking:propose'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/**
 * A personal access token a patient creates to connect an AI assistant (an MCP
 * client) to their account.
 *
 * The token itself is shown once and never stored — only its SHA-256 hash. Tokens are
 * 190+ bits of randomness, so an unsalted hash is sufficient (the same scheme GitHub
 * uses for PATs); a salt defends low-entropy secrets like passwords, not these.
 * Deliberately absent from the scope list: anything that confirms a booking or moves
 * money. Those stay in SymptoBridge's own UI.
 */
export interface IApiToken extends Document {
  user: mongoose.Types.ObjectId;
  name: string;
  tokenHash: string;
  /** First characters of the secret, so the user can tell tokens apart in a list. */
  prefix: string;
  scopes: ApiTokenScope[];
  expiresAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
}

const apiTokenSchema = new Schema<IApiToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    tokenHash: { type: String, required: true, unique: true },
    prefix: { type: String, required: true },
    scopes: [{ type: String, enum: API_TOKEN_SCOPES }],
    expiresAt: { type: Date, required: true },
    lastUsedAt: Date,
    revokedAt: Date,
  },
  { timestamps: true }
);

export const ApiToken = mongoose.model<IApiToken>('ApiToken', apiTokenSchema);
