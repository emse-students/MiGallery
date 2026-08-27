/**
 * Opaque server-side sessions.
 *
 * The login cookie holds a random token and nothing else: every fact about the
 * session (who it belongs to, when it dies, whether an admin is impersonating
 * someone through it) is a column here. That is what makes a session revocable -
 * logging out is a DELETE, and no credential the client holds outlives it.
 *
 * Same model as Sky (`src/lib/server/session.ts` there), deliberately.
 */
import { randomUUID } from 'crypto';
import { getDatabase } from '$lib/db/database';
import { createLogger } from '$lib/server/logger';
import type { UserRow } from '$lib/types/api';

const log = createLogger('sessions');

/** Session lifetime. Same 7 days as Sky and as the Canari refresh token. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * A live session and the users it resolves to.
 *
 * `user` is who the request acts AS, `realUser` is the account that actually
 * authenticated. They differ only while an admin impersonates someone; keeping
 * both is what lets an impersonation be ended without trusting the impersonated
 * identity to authorise it.
 */
export interface ResolvedSession {
  token: string;
  user: UserRow;
  realUser: UserRow;
  impersonating: boolean;
  expiresAt: number;
}

interface SessionRow {
  token: string;
  id_user: string;
  impersonated_id_user: string | null;
  expires_at: number;
}

function findUser(id: string): UserRow | null {
  const row = getDatabase().prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(id) as
    | UserRow
    | undefined;

  return row ?? null;
}

/** Open a session for a user. Returns the token to hand to the cookie. */
export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomUUID();
  const createdAt = nowEpoch();
  const expiresAt = createdAt + SESSION_TTL_SECONDS;

  getDatabase()
    .prepare(
      'INSERT INTO sessions (token, id_user, impersonated_id_user, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)'
    )
    .run(token, userId, createdAt, expiresAt);

  log.info('session created', { userId, expiresAt });

  return { token, expiresAt };
}

/**
 * Resolve a session token, or null when it is unknown, expired or points at a
 * user that no longer exists. Called on every request, so it stays quiet unless
 * something is actually wrong.
 */
export function resolveSession(token: string | undefined | null): ResolvedSession | null {
  if (!token) {
    return null;
  }

  const row = getDatabase()
    .prepare(
      'SELECT token, id_user, impersonated_id_user, expires_at FROM sessions WHERE token = ? AND expires_at > ? LIMIT 1'
    )
    .get(token, nowEpoch()) as SessionRow | undefined;

  if (!row) {
    return null;
  }

  const realUser = findUser(row.id_user);
  if (!realUser) {
    // The account was deleted while the session lived. The FK cascade normally
    // removes the row with it, so reaching here means the two disagree.
    log.warn('session references an unknown user, dropping it', { id: row.id_user });
    deleteSession(row.token);

    return null;
  }

  const impersonated = row.impersonated_id_user ? findUser(row.impersonated_id_user) : null;
  if (row.impersonated_id_user && !impersonated) {
    log.warn('session impersonates an unknown user, clearing it', { id: row.impersonated_id_user });
    setSessionImpersonation(row.token, null);
  }

  return {
    token: row.token,
    user: impersonated ?? realUser,
    realUser,
    impersonating: impersonated !== null,
    expiresAt: row.expires_at,
  };
}

/** End one session (logout). */
export function deleteSession(token: string): void {
  getDatabase().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  log.info('session deleted');
}

/**
 * Start or stop impersonating through an existing session. Pass null to stop.
 * The caller is responsible for checking that the session's REAL user may do it.
 */
export function setSessionImpersonation(token: string, impersonatedId: string | null): void {
  getDatabase()
    .prepare('UPDATE sessions SET impersonated_id_user = ? WHERE token = ?')
    .run(impersonatedId, token);
  log.info('session impersonation changed', { impersonating: impersonatedId !== null });
}

/** Drop expired rows. Called opportunistically at login, never on a read path. */
export function deleteExpiredSessions(): void {
  const result = getDatabase()
    .prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .run(nowEpoch());
  if (result.changes > 0) {
    log.debug('expired sessions purged', { count: result.changes });
  }
}
