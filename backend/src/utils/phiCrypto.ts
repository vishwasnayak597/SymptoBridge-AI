import crypto from 'crypto';
import logger from './logger';

/**
 * Field-level encryption for PHI (Protected Health Information).
 *
 * Format: enc:v1:<iv>:<authTag>:<ciphertext>  (all base64)
 * Cipher: AES-256-GCM — authenticated encryption, so tampered or wrongly-keyed
 * data fails loudly instead of decrypting to garbage.
 *
 * Guarantees that make this safe to roll out over existing data:
 *  - decryptPhi() passes through any value WITHOUT the enc:v1: prefix
 *    untouched — legacy plaintext rows keep displaying exactly as before.
 *  - Without PHI_ENCRYPTION_KEY set, encryptPhi() is a no-op (plus a one-time
 *    warning), so the app never breaks because of a missing env var.
 *  - The version tag (v1) leaves room for future key/algorithm rotation.
 */

const PREFIX = 'enc:v1:';
let warned = false;

function getKey(): Buffer | null {
  const secret = process.env.PHI_ENCRYPTION_KEY;
  if (!secret) {
    if (!warned) {
      warned = true;
      logger.warn('PHI_ENCRYPTION_KEY not set — PHI fields are stored in plaintext');
    }
    return null;
  }
  // Accept any passphrase; derive a fixed 32-byte key from it.
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptPhi(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext; // already encrypted

  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptPhi(value: string): string {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value; // legacy plaintext

  const key = getKey();
  if (!key) {
    logger.error('Encrypted PHI present but PHI_ENCRYPTION_KEY is not set');
    return '[encrypted — key unavailable]';
  }

  try {
    const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    logger.error('PHI decryption failed (wrong key or corrupted data)', { message: (err as Error).message });
    return '[encrypted — decryption failed]';
  }
}
