/**
 * `POST /api/internal/alumni-merge` - Canari's call, server to server, for one Alumni merge
 * (D54): `Authorization: Bearer <canari-merge+jwt>`, body ignored (everything it acts on is a
 * signed claim). Answers:
 *
 * - 200 `{ outcome }`: `transferred`, `erased` (erase-only mode) or `absent` (no duplicate here:
 *   never signed in, or already done - a retry after a lost answer lands here).
 * - 409 `{ code }`: a typed refusal on this site's state; Canari blocks the job, a human looks.
 * - 401 `{ outcome }`: the token is refused (its class, from the vendored
 *   `handoff/alumni-merge-verify.ts`); 503 `{ outcome: 'not_configured' }` when this deployment
 *   trusts no Canari issuer; 503 `{ outcome: 'keys_unavailable' }` when Canari's keys cannot be
 *   fetched; 503 `{ code: 'FACE_STORE_KEY_UNAVAILABLE' }` when the face key cannot - all retried.
 *
 * Every line names the job id and 8-character subject prefixes, never a token, a name or a
 * face datum.
 */
import type { JWTVerifyGetKey } from 'jose';
import { getDatabase } from '#lib/db/database.ts';
import { createLogger } from '#lib/server/logger.ts';
import { env } from '#lib/server/env.ts';
import { HANDOFF_AUDIENCE, handoffTrust } from '#lib/server/handoff/redeem.ts';
import { verifyAlumniMergeCall } from '#lib/server/handoff/alumni-merge-verify.ts';
import {
  AlumniMergeRefusal,
  FaceKeyUnavailableError,
  mergeAlumniDuplicate,
} from '#lib/server/alumni-merge/merge.ts';

const log = createLogger('alumni-merge');

/** The longest token the `Authorization` header may carry. */
const ALUMNI_MERGE_TOKEN_MAX_LENGTH = 4096;

/** What the endpoint answers. */
export interface AlumniMergeAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** The request, as far as the endpoint needs it. */
export interface AlumniMergeCallInput {
  authorization: string | null;
  /** The clock; tests pass theirs. */
  now?: Date;
  /** The keys; tests pass a local set. Default: Canari's JWKS from the configuration. */
  keys?: JWTVerifyGetKey;
}

/** Authenticate the call, then run the merge. Never throws for a caller's input. */
export async function handleAlumniMergeCall(
  input: AlumniMergeCallInput
): Promise<AlumniMergeAnswer> {
  log.debug('[ALUMNI_MERGE] call');
  const trust = input.keys
    ? { issuer: env.CANARI_HANDOFF_ISSUER?.trim() ?? '', keys: input.keys }
    : handoffTrust();
  if (!trust || !trust.issuer) {
    // Canari calls only a site it believes ready: a call reaching an unconfigured one is a fault.
    log.error(
      '[ALUMNI_MERGE] refused: no Canari issuer is configured (CANARI_HANDOFF_ISSUER, CANARI_HANDOFF_JWKS)'
    );
    return { status: 503, body: { outcome: 'not_configured' } };
  }
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(input.authorization ?? '');
  if (!match || match[1].length > ALUMNI_MERGE_TOKEN_MAX_LENGTH) {
    log.warn('[ALUMNI_MERGE] refused class=no_token');
    return { status: 401, body: { outcome: 'invalid' } };
  }
  const verified = await verifyAlumniMergeCall(match[1], {
    keys: trust.keys,
    issuer: trust.issuer,
    audience: HANDOFF_AUDIENCE,
    currentDate: input.now,
  });
  if (verified.outcome !== 'ok') {
    if (verified.outcome === 'keys_unavailable') {
      log.error(
        '[ALUMNI_MERGE] refused class=keys_unavailable: Canari`s keys could not be fetched'
      );
      return { status: 503, body: { outcome: 'keys_unavailable' } };
    }
    log.warn(`[ALUMNI_MERGE] refused class=${verified.outcome}`);
    return { status: 401, body: { outcome: verified.outcome } };
  }
  try {
    const outcome = mergeAlumniDuplicate(getDatabase(), verified.claims);
    return { status: 200, body: { outcome } };
  } catch (e) {
    if (e instanceof AlumniMergeRefusal) {
      return { status: 409, body: { code: e.code } };
    }
    if (e instanceof FaceKeyUnavailableError) {
      return { status: 503, body: { code: e.code } };
    }
    log.error(`[ALUMNI_MERGE] failed jti=${verified.claims.jti}`, (e as Error).message);
    return { status: 500, body: { code: 'ALUMNI_MERGE_FAILED' } };
  }
}
