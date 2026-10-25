/**
 * Sealing of face templates at rest (AES-256-GCM). A template is biometric data: the database file
 * and its backups must never hold one in the clear.
 *
 * Layout of a sealed blob: 12-byte random nonce | ciphertext | 16-byte tag (28 bytes over the
 * plaintext). The `context` string is authenticated but not stored: it names the row the blob
 * belongs to, so a blob copied onto another row, or another model's row, fails to open instead of
 * silently matching the wrong person.
 *
 * The key is a 32-byte secret (64 hex characters) in the environment, held by the server alone.
 * Rotating it makes every sealed blob unreadable, which is also the way to erase the whole store.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createLogger } from '$lib/server/logger';

const log = createLogger('face-seal');

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Bytes a sealing adds to its plaintext. */
export const SEAL_OVERHEAD = NONCE_BYTES + TAG_BYTES;

/** Parse the secret: exactly 64 hex characters. Throws otherwise, never falling back to a weaker key. */
export function parseSealKey(raw: string | undefined): Buffer {
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    log.error('face seal key is missing or not 64 hex characters');
    throw new Error('FACE_STORE_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(raw, 'hex');
}

/** Seal `plaintext` for the row named by `context`. */
export function seal(key: Buffer, context: string, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

/** Open a blob sealed for `context`. Throws when the key, the context or the bytes differ. */
export function unseal(key: Buffer, context: string, sealed: Uint8Array): Uint8Array {
  if (sealed.length < SEAL_OVERHEAD) {
    log.error('sealed blob is shorter than its own overhead', { bytes: sealed.length });
    throw new Error('sealed blob is too short');
  }
  const buf = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, NONCE_BYTES));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(buf.subarray(buf.length - TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch (error) {
    log.error('a sealed blob failed authentication', { context: context.split(':')[0] });
    throw error;
  }
}
