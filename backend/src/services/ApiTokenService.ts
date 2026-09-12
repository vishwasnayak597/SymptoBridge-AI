import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiToken, ApiTokenScope, API_TOKEN_SCOPES, IApiToken } from '../models/ApiToken';
import User, { IUserDocument } from '../models/User';

const TOKEN_PREFIX = 'sb_pat_';
const DEFAULT_TTL_DAYS = 30;
const MAX_ACTIVE_TOKENS = 5;

function hash(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export interface AuthenticatedToken {
  user: IUserDocument;
  token: IApiToken;
}

/**
 * Personal access tokens for connecting AI assistants over MCP.
 *
 * The secret is returned exactly once, at creation. Lookups hash the presented token
 * and compare hashes, so a database leak doesn't hand out working credentials.
 */
export class ApiTokenService {
  static async create(
    userId: string,
    name: string,
    scopes: ApiTokenScope[] = [...API_TOKEN_SCOPES],
    ttlDays = DEFAULT_TTL_DAYS
  ): Promise<{ token: string; record: IApiToken }> {
    const active = await ApiToken.countDocuments({
      user: userId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    if (active >= MAX_ACTIVE_TOKENS) {
      throw new Error(`You can have at most ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`);
    }

    const secret = TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
    const record = await ApiToken.create({
      user: userId,
      name,
      tokenHash: hash(secret),
      prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
      scopes,
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    });
    return { token: secret, record };
  }

  static async list(userId: string) {
    return ApiToken.find({ user: userId, revokedAt: { $exists: false } })
      .select('name prefix scopes expiresAt lastUsedAt createdAt')
      .sort({ createdAt: -1 })
      .lean();
  }

  static async revoke(userId: string, tokenId: string): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(tokenId)) return false;
    const result = await ApiToken.updateOne(
      { _id: tokenId, user: userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } }
    );
    return result.modifiedCount > 0;
  }

  /** The user and token behind a presented secret, or null if it isn't live. */
  static async authenticate(secret: string | undefined): Promise<AuthenticatedToken | null> {
    if (!secret || !secret.startsWith(TOKEN_PREFIX)) return null;

    const token = await ApiToken.findOne({
      tokenHash: hash(secret),
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    if (!token) return null;

    const user = await User.findById(token.user);
    if (!user || !user.isActive) return null;

    // Best-effort usage stamp, throttled so a chatty client isn't a write per call.
    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
      ApiToken.updateOne({ _id: token._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    }
    return { user, token };
  }
}
