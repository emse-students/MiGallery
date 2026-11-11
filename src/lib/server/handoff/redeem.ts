/**
 * THE SIGN-IN HANDOFF'S REDEMPTION - Canari, signed in, opens MiGallery with a 60-second token in
 * the fragment of `/auth/handoff`; the landing page posts it here, and this opens MiGallery's
 * ordinary session, MARKED (docs/wiki/authentication.md, "Signed in from Canari"; the contract is
 * Canari's docs/wiki/backlog.d/sign-in-handoff-to-the-ecosystem-sites-and-migallery-notifications.md,
 * section 8 - the step numbers below are its).
 *
 * Steps 1-3 are the vendored verifier (`handoff-verify.ts`, byte-identical to Canari's source).
 * What is MiGallery's: the `Origin` check, the interstitial ALWAYS before anything is written, single
 * use from the `handoff_redemptions` ledger (the INSERT is the decision), the admission (F1: the
 * EXISTING row, nothing written on it) and the marked session.
 *
 * Every refusal is logged with its class and the `jti` when known - NEVER the token.
 */
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { safeRedirectTarget } from '#lib/auth-redirect.ts';
import { computeAvatarSignature } from '#lib/server/avatar-signature.ts';
import { avatarSaltOf } from '#lib/server/avatar-revocation.ts';
import { getDatabase } from '#lib/db/database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import { createSession, deleteSession, type ResolvedSession } from '#lib/db/sessions.ts';
import { env } from '#lib/server/env.ts';
import { createLogger } from '#lib/server/logger.ts';
import {
  HANDOFF_LEEWAY_SECONDS,
  verifyHandoff,
  type HandoffRefusalClass,
} from '#lib/server/handoff/handoff-verify.ts';
import type { UserRow } from '#lib/types/api.ts';

const log = createLogger('handoff');

/** MiGallery's id in Canari's registry: a constant of this site, never a variable. */
export const HANDOFF_AUDIENCE = 'migallery';
/** The longest token the body may carry. */
export const HANDOFF_TOKEN_MAX_LENGTH = 4096;
/**
 * How long a fetched JWKS is trusted: within 60-120 s, never jose's 10-minute default, so a key
 * Canari rotated out stops verifying within two minutes. An unknown `kid` refetches at once.
 */
export const HANDOFF_JWKS_CACHE_MS = 60_000;

/** What the redemption answers: the HTTP status and the JSON body the landing page reads. */
export interface Redemption {
  status: number;
  body: Record<string, unknown>;
  /** Set when a session was opened: the cookie to hand the browser. */
  session?: { token: string; expiresAt: number };
}

/** The request, as far as the redemption needs it. */
export interface RedeemInput {
  /** The request's `Origin` header. */
  origin: string | null;
  /** MiGallery's own origin (`event.url.origin`). */
  ownOrigin: string;
  contentType: string | null;
  /** The parsed JSON body, or `undefined` when it was not JSON. */
  body: unknown;
  /** The live session this browser already holds, if any. */
  current: ResolvedSession | null;
  /** The clock; tests pass the vector's. */
  now?: Date;
  /** The keys; tests pass a local set. Default: Canari's JWKS from the configuration. */
  keys?: JWTVerifyGetKey;
}

let jwks: { url: string; keys: JWTVerifyGetKey } | null = null;

/** The issuer and keys this deployment trusts, or null when the handoff is not configured. */
export function handoffTrust(): { issuer: string; keys: JWTVerifyGetKey } | null {
  const issuer = env.CANARI_HANDOFF_ISSUER?.trim();
  const url = env.CANARI_HANDOFF_JWKS?.trim();
  if (!issuer || !url) {
    return null;
  }
  if (!jwks || jwks.url !== url) {
    jwks = {
      url,
      keys: createRemoteJWKSet(new URL(url), { cacheMaxAge: HANDOFF_JWKS_CACHE_MS }),
    };
  }
  return { issuer, keys: jwks.keys };
}

/** `dest` as MiGallery's redirect validator sees it: the home page, or a path it accepts. */
export function handoffDestAllowed(dest: string): boolean {
  return dest === '/' || safeRedirectTarget(dest) === dest;
}

function refuse(status: number, outcome: string, jti: string | null): Redemption {
  const line = `[HANDOFF] refused class=${outcome} jti=${jti ?? 'none'}`;
  if (outcome === 'keys_unavailable') {
    // Canari's keys could not be fetched: an outage on our side of the contract, not the token's.
    log.error(line);
  } else if (outcome === 'replayed' || outcome === 'bad_origin') {
    log.warn(line);
  } else {
    log.info(line);
  }
  return { status, body: { outcome } };
}

function findUser(id: string): UserRow | null {
  return (
    (getDatabase()
      .prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1')
      .get(id) as UserRow | null) ?? null
  );
}

/** The name the interstitial shows for a user row. */
function displayName(user: UserRow): string {
  const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return full || user.name || user.id_user;
}

/**
 * The avatar the interstitial shows, through MiGallery's own avatar route. The browser usually has
 * no session yet, so the URL is the SIGNED one (`avatar-signature.ts`, the keyless link MiConnect
 * already hands out): only the holder of a token naming this user is shown it, and it shows nothing
 * but that user's own photo. Without the signing key, the plain URL, which a session can read.
 */
function avatarOf(user: UserRow): string | null {
  if (!user.photos_asset_id) {
    return null;
  }
  const base = `/api/users/${encodeURIComponent(user.id_user)}/avatar?v=${encodeURIComponent(user.photos_asset_id)}`;
  const key = env.AVATAR_SIGNING_KEY;
  if (!key) {
    return base;
  }
  const sig = computeAvatarSignature(key, user.id_user, avatarSaltOf(getDatabase(), user.id_user));
  return `${base}&sig=${encodeURIComponent(sig)}`;
}

/** The redemption, steps 0 to 7. Never throws for a client's input; a database fault does. */
export async function redeemHandoff(input: RedeemInput): Promise<Redemption> {
  // 0. Same origin, JSON, the token in the body.
  if (input.origin !== input.ownOrigin) {
    return refuse(403, 'bad_origin', null);
  }
  if (!(input.contentType ?? '').toLowerCase().startsWith('application/json')) {
    return refuse(415, 'invalid', null);
  }
  const body = (input.body ?? null) as { token?: unknown; confirm?: unknown } | null;
  const token = body?.token;
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > HANDOFF_TOKEN_MAX_LENGTH ||
    (body?.confirm !== undefined && typeof body.confirm !== 'boolean')
  ) {
    return refuse(400, 'invalid', null);
  }
  const confirm = body?.confirm === true;

  const trust = input.keys
    ? { issuer: env.CANARI_HANDOFF_ISSUER?.trim() ?? '', keys: input.keys }
    : handoffTrust();
  if (!trust || !trust.issuer) {
    return refuse(404, 'not_offered', null);
  }

  // 1-3. Signature, header, issuer, audience, time, lifetime, dest.
  const now = input.now ?? new Date();
  const verified = await verifyHandoff(token, {
    keys: trust.keys,
    issuer: trust.issuer,
    audience: HANDOFF_AUDIENCE,
    redirectAllows: handoffDestAllowed,
    currentDate: now,
  });
  if (verified.outcome !== 'ok') {
    const status = verified.outcome === 'keys_unavailable' ? 503 : 400;
    return refuse(status, verified.outcome satisfies HandoffRefusalClass, null);
  }
  const { sub, jti, dest, exp } = verified.claims;

  // 4. The interstitial, ALWAYS - unless this browser is already signed in as the same user,
  // when nothing changes hands. Nothing is written: the click redeems the same token.
  const user = findUser(sub);
  if (!user) {
    // 6 (F1): a `sub` never seen here goes through MiConnect, an honest first visit.
    log.info(`[HANDOFF] unknown_user jti=${jti}`);
    return { status: 200, body: { outcome: 'unknown_user', dest } };
  }
  const sameUser = input.current?.realUser.id_user === sub;
  if (!confirm && !sameUser) {
    return {
      status: 200,
      body: {
        outcome: 'confirm',
        current: input.current ? displayName(input.current.realUser) : null,
        next: { name: displayName(user), photo: avatarOf(user) },
      },
    };
  }

  // 5-7 in ONE transaction: the ledger row, the old session's deletion and the new session land
  // together or not at all - a token is never spent without a session, nor a session left half
  // replaced.
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const db = getDatabase();
  const current = input.current;
  return inTransaction(db, (): Redemption => {
    // 5. Single use: the INSERT is the decision. The dead rows go first, by proof: a row whose
    // `exp` is past the leeway belongs to a token step 3 refuses, so it protects nothing.
    db.prepare('DELETE FROM handoff_redemptions WHERE exp < ?').run(
      nowSeconds - HANDOFF_LEEWAY_SECONDS
    );
    const inserted = db
      .prepare(
        'INSERT OR IGNORE INTO handoff_redemptions (jti, sub, exp, redeemed_at) VALUES (?, ?, ?, ?)'
      )
      .run(jti, sub, exp, nowSeconds);
    if (inserted.changes !== 1) {
      return refuse(409, 'replayed', jti);
    }

    // 6-7. Admission (F1: the existing row, nothing written on it) and the ordinary session,
    // MARKED. A session of another user is replaced; the same user's is kept as it is (an OIDC
    // session stays unmarked).
    if (sameUser) {
      log.info(`[HANDOFF] redeemed jti=${jti} sub=${sub} session=kept`);
      return { status: 200, body: { outcome: 'ok', dest } };
    }
    if (current) {
      deleteSession(current.token);
    }
    const session = createSession(sub, { viaHandoff: true });
    log.info(`[HANDOFF] redeemed jti=${jti} sub=${sub}`);
    return { status: 200, body: { outcome: 'ok', dest }, session };
  });
}
