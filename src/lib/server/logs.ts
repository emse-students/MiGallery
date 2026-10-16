/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { getDatabase } from '$lib/db/database';
import type { RequestEvent } from '@sveltejs/kit';
import { getRequestSession } from '$lib/server/auth';
import { createLogger } from '$lib/server/logger';

const log = createLogger('audit-log');

/**
 * Log an event to the local DB `logs` table.
 * event: the SvelteKit request event (used to extract actor/ip when possible)
 */
export function logEvent(
  event: RequestEvent | undefined | null,
  eventType: string,
  targetType: string | null = null,
  targetId: string | null = null,
  details: unknown = null
) {
  try {
    const db = getDatabase();

    let actor: string | null = null;
    try {
      // An audit trail names the account that ACTED. While an admin impersonates
      // someone, that is still the admin - so the session is asked first, and for
      // its real user, rather than for the identity the request is wearing.
      if (event?.cookies) {
        const session = getRequestSession({ locals: event.locals, cookies: event.cookies });
        if (session) {
          actor = session.realUser.id_user;
        }
      }

      if (!actor && event?.locals) {
        const localUser = (event.locals as any).user;
        if (localUser) {
          actor = (localUser.id_user || localUser.id || localUser.email) as string;
        }

        if (!actor && (event.locals as any).userId) {
          actor = (event.locals as any).userId as string;
        }
      }
    } catch {
      actor = null;
    }

    if (!actor && details && typeof details === 'object' && 'actor' in details) {
      actor = (details as any).actor;
    }

    // The client address, from ONE trusted source: SvelteKit's getClientAddress(). In production
    // adapter-node reads it from the header named by ADDRESS_HEADER, set to `cf-connecting-ip`
    // in docker-compose.prod.yml - the only public way in is the Cloudflare tunnel, and Cloudflare
    // overwrites that header with the address it received the request from. X-Forwarded-For is
    // never read: its first value is whatever the client chose to send (docs/wiki/data-model.md#logs).
    let ip: string | null = null;
    if (event && typeof event.getClientAddress === 'function') {
      try {
        ip = event.getClientAddress().slice(0, 64) || null;
      } catch (e) {
        log.warn('client address unavailable for the audit log', (e as Error).message);
      }
    }

    const stmt = db.prepare(
      'INSERT INTO logs (actor, event_type, target_type, target_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(actor, eventType, targetType, targetId, details ? JSON.stringify(details) : null, ip);
  } catch (e) {
    log.warn('logEvent failed', (e as Error).message || e);
  }
}

/** How long an audit-log row is kept. */
export const LOG_RETENTION_DAYS = 90;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Delete audit-log rows older than {@link LOG_RETENTION_DAYS}. `timestamp` is SQLite's
 * `datetime('now')` text (UTC, `YYYY-MM-DD HH:MM:SS`), which sorts as it reads, so the comparison
 * is a plain string one. Returns the number of rows deleted.
 */
export function purgeOldLogs(): number {
  const db = getDatabase();
  const { changes } = db
    .prepare("DELETE FROM logs WHERE timestamp < datetime('now', ?)")
    .run(`-${LOG_RETENTION_DAYS} days`);
  log.info('audit log purged', { deleted: changes, retentionDays: LOG_RETENTION_DAYS });
  return changes;
}

let retentionStarted = false;

/**
 * Run {@link purgeOldLogs} a minute after start, then once a day, in-process (like the backup scheduler). The
 * timer only decides when; what goes is decided by each row's own timestamp, so a missed day just
 * means the next run deletes two days' worth.
 */
export function startLogRetention(): void {
  if (retentionStarted) {
    return;
  }
  retentionStarted = true;
  const run = () => {
    try {
      purgeOldLogs();
    } catch (e) {
      log.error('audit log purge failed', e);
    }
  };
  // A minute after start rather than during it, and unref'd: neither timer may hold a process open.
  setTimeout(run, 60_000).unref?.();
  setInterval(run, PURGE_INTERVAL_MS).unref?.();
}
