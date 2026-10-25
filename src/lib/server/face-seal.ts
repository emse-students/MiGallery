/**
 * Sealing of face templates at rest (AES-256-GCM). A template is biometric data: the database file
 * and its backups must never hold one in the clear.
 *
 * Layout of a sealed blob: 1-byte format version | 12-byte random nonce | ciphertext | 16-byte tag
 * (29 bytes over the plaintext). The version is also the key id: version 1 is opened with the one
 * key. The `context` string is authenticated (together with the version) but not stored: it names
 * what the blob belongs to - see {@link referenceContext} and {@link embeddingContext} for exactly
 * what each table binds - so a blob copied elsewhere fails to open instead of silently matching
 * the wrong person. An unknown version is refused, never guessed.
 *
 * KEY ROTATION PATH. Add version 2 with its own secret (a second environment variable), make seal()
 * write 2, keep opening 1 with the old key, re-seal rows in the background, then drop version 1.
 * Nothing needs a table change because the version travels in the blob.
 *
 * The key is a 32-byte secret (64 hex characters) in the environment, held by the server alone.
 * Rotating it makes every sealed blob unreadable, which is also the way to erase the whole store.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createLogger } from '$lib/server/logger';

const log = createLogger('face-seal');

/** The only format (and key) version written and read today. */
export const SEAL_VERSION = 1;
const VERSION_BYTES = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Bytes a sealing adds to its plaintext. */
export const SEAL_OVERHEAD = VERSION_BYTES + NONCE_BYTES + TAG_BYTES;

/**
 * Canonical context of a `face_references` blob: the MEMBER and the MODEL. It does not name the
 * row: a member's references are interchangeable, so one copied onto another of the same member
 * opens (harmless: same person, same model). JSON, not ':'-joined, so no two pairs collide.
 */
export function referenceContext(userId: string, model: string): string {
  return JSON.stringify(['face_references', userId, model]);
}

/** Canonical context of a `face_embeddings` blob: its whole key (asset, face index) and the model. */
export function embeddingContext(assetId: string, faceIndex: number, model: string): string {
  return JSON.stringify(['face_embeddings', assetId, faceIndex, model]);
}

/** The authenticated data: the version byte then the context. */
function aad(version: number, context: string): Buffer {
  return Buffer.concat([Buffer.from([version]), Buffer.from(context, 'utf8')]);
}

/** The table a context names, for a log line that must not carry an id. */
function contextTable(context: string): string {
  try {
    const parsed: unknown = JSON.parse(context);
    return Array.isArray(parsed) ? String(parsed[0]) : 'unknown';
  } catch {
    return 'unknown';
  }
}

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
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(SEAL_VERSION, context));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([SEAL_VERSION]), nonce, body, cipher.getAuthTag()]);
}

/** Open a blob sealed for `context`. Throws when the key, the context or the bytes differ. */
export function unseal(key: Buffer, context: string, sealed: Uint8Array): Uint8Array {
  if (sealed.length < SEAL_OVERHEAD) {
    log.error('sealed blob is shorter than its own overhead', { bytes: sealed.length });
    throw new Error('sealed blob is too short');
  }
  const buf = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  const version = buf[0];
  if (version !== SEAL_VERSION) {
    log.error('sealed blob has an unknown format version', { version });
    throw new Error(`unknown seal version ${version}`);
  }
  const nonce = buf.subarray(VERSION_BYTES, VERSION_BYTES + NONCE_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad(version, context));
  decipher.setAuthTag(buf.subarray(buf.length - TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(buf.subarray(VERSION_BYTES + NONCE_BYTES, buf.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch (error) {
    log.error('a sealed blob failed authentication', { table: contextTable(context) });
    throw error;
  }
}
