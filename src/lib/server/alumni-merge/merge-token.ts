/**
 * THE ALUMNI MERGE CALL TOKEN - how MiGallery knows a `POST /api/internal/alumni-merge` comes from
 * Canari (Canari's docs/wiki/profiles-and-access.md, D54; the sender is core-service's
 * `alumni-merge-site-jobs.service.ts`).
 *
 * Canari signs one token per call with its HANDOFF key: ES256, header `typ: canari-merge+jwt`,
 * issuer `CANARI_HANDOFF_ISSUER`, audience this site's id (`migallery`), claims `dup` (the
 * duplicate's subject), `target` (the real account's subject), `jti` (the job id), `iat`, `exp`
 * (60 s). Same key and same JWKS as the sign-in handoff, its OWN `typ`, so neither verifier ever
 * takes one token for the other (RFC 8725): no new secret, the trust is `handoffTrust()`.
 *
 * NOT VENDORED YET: Canari will ship a shared verifier for this type in `libs/handoff/`; until then
 * this file is the same as Sky's (`src/lib/server/alumni-merge/verify.ts`), and it is replaced by
 * the byte-identical copy when it lands. Classified by the error's CLASS, never its message; a failure to OBTAIN the
 * keys is `keys_unavailable` (an outage, 503), anything the token carries is the token's fault.
 * It never logs and never returns the token.
 *
 * `mode` is an OPTIONAL signed claim this site accepts ahead of the sender: absent or `transfer`
 * is the merge, `erase` is the "target erased in the meantime" variant (erase the duplicate, move
 * nothing). It is a claim and not a body field so that nobody holding a token can turn a transfer
 * into an erasure.
 */
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import {
  HANDOFF_LEEWAY_SECONDS,
  HANDOFF_MAX_LIFETIME_SECONDS,
} from '#lib/server/handoff/handoff-verify.ts';

/** The token's `typ` header; jose compares it case-insensitively, `application/` optional. */
export const ALUMNI_MERGE_TOKEN_TYPE = 'canari-merge+jwt';
/** The longest token the `Authorization` header may carry. */
export const ALUMNI_MERGE_TOKEN_MAX_LENGTH = 4096;

/** What a call asks: move then erase, or erase only. */
export type AlumniMergeMode = 'transfer' | 'erase';

/** Why a token was refused. */
export type AlumniMergeRefusalClass =
  | 'keys_unavailable'
  | 'invalid'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'not_yet_valid'
  | 'too_long';

/** The claims of a verified call. */
export interface AlumniMergeClaims {
  dup: string;
  target: string;
  jti: string;
  mode: AlumniMergeMode;
}

export type AlumniMergeVerification =
  | { outcome: 'ok'; claims: AlumniMergeClaims }
  | { outcome: AlumniMergeRefusalClass };

export interface AlumniMergeVerifyOptions {
  /** Canari's keys (`handoffTrust().keys`). */
  keys: JWTVerifyGetKey;
  /** The ONE issuer accepted (`CANARI_HANDOFF_ISSUER`). */
  issuer: string;
  /** This site's id in Canari's registry - a constant of the site. */
  audience: string;
  /** The clock; tests pass theirs. */
  currentDate?: Date;
}

/** The key resolver could not obtain Canari's keys. */
class KeysUnavailable extends Error {
  constructor(readonly cause: unknown) {
    super('alumni merge keys unavailable');
  }
}

/** A subject as MiConnect writes it (`hashed_user_id`: 64 hex) or any opaque id: bounded, printable (Sky's rule). */
const SUBJECT = /^[A-Za-z0-9._-]{1,128}$/;
const isSubject = (value: unknown): value is string =>
  typeof value === 'string' && SUBJECT.test(value);

/** Signature and header, issuer and audience, time and lifetime, then the claims' shapes. */
export async function verifyAlumniMergeCall(
  token: string,
  options: AlumniMergeVerifyOptions
): Promise<AlumniMergeVerification> {
  const currentDate = options.currentDate ?? new Date();
  const keys: JWTVerifyGetKey = async (header, tok) => {
    try {
      return await options.keys(header, tok);
    } catch (e) {
      if (e instanceof errors.JWKSNoMatchingKey || e instanceof errors.JWKSMultipleMatchingKeys) {
        throw e;
      }
      throw new KeysUnavailable(e);
    }
  };
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      algorithms: ['ES256'],
      typ: ALUMNI_MERGE_TOKEN_TYPE,
      issuer: options.issuer,
      audience: options.audience,
      clockTolerance: HANDOFF_LEEWAY_SECONDS,
      requiredClaims: ['dup', 'target', 'jti', 'iat', 'exp'],
      currentDate,
    }));
  } catch (e) {
    return { outcome: classify(e) };
  }
  const { dup, target, jti, iat, exp, mode } = payload;
  if (
    !isSubject(dup) ||
    !isSubject(target) ||
    !isSubject(jti) ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    (mode !== undefined && mode !== 'transfer' && mode !== 'erase')
  ) {
    return { outcome: 'invalid' };
  }
  const now = Math.floor(currentDate.getTime() / 1000);
  if (iat > now + HANDOFF_LEEWAY_SECONDS) {
    return { outcome: 'not_yet_valid' };
  }
  if (exp - iat > HANDOFF_MAX_LIFETIME_SECONDS) {
    return { outcome: 'too_long' };
  }
  return {
    outcome: 'ok',
    claims: { dup, target, jti, mode: mode === 'erase' ? 'erase' : 'transfer' },
  };
}

/** A jose failure, as a refusal class. Anything unrecognised is `invalid`. */
function classify(e: unknown): AlumniMergeRefusalClass {
  if (e instanceof KeysUnavailable) {
    return 'keys_unavailable';
  }
  if (e instanceof errors.JWTExpired) {
    return 'expired';
  }
  if (e instanceof errors.JWTClaimValidationFailed) {
    if (e.claim === 'iss') {
      return 'wrong_issuer';
    }
    if (e.claim === 'aud') {
      return 'wrong_audience';
    }
    if (e.claim === 'iat' || e.claim === 'nbf') {
      return 'not_yet_valid';
    }
  }
  return 'invalid';
}
