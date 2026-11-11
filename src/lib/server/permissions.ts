/**
 * Centralized permission management system for the API
 *
 * Scope hierarchy:
 * - public: No authentication required
 * - read: Read-only (session OR x-api-key with 'read' scope)
 * - write: Read + write (session OR x-api-key with 'write' scope)
 * - admin: Administrator access (admin session OR x-api-key with 'admin' scope)
 *
 * Note: The 'admin' scope on an API key grants access to ALL admin endpoints.
 */

import { error } from '@sveltejs/kit';
import { verifyRawKeyWithScope } from '#lib/db/api-keys.ts';
import { getCurrentUser, ensureAdmin } from '#lib/server/auth.ts';
import type { RequestEvent } from '@sveltejs/kit';
import type { UserRow } from '#lib/types/api.ts';
import { logEvent } from '#lib/server/logs.ts';
import { createLogger } from '#lib/server/logger.ts';
import { isStaffRole } from '#lib/roles.ts';

const log = createLogger('permissions');

export type Scope = 'public' | 'read' | 'write' | 'admin';

export interface AuthResult {
  /** The authenticated user (null if authenticated via API key) */
  user: UserRow | null;
  /** The effective granted scope */
  grantedScope: Scope;
  /** True if authenticated via API key */
  viaApiKey: boolean;
}

/**
 * Verifies that the request has at least the requested scope.
 *
 * @param event - The SvelteKit request event
 * @param requiredScope - The minimum required scope
 * @param allowSelf - If true, allows the user to access their own resources (for GET/PUT on /users/{id})
 * @param targetUserId - The target user ID (to check allowSelf)
 * @returns AuthResult containing the user and the granted scope
 * @throws Error 401/403 if not authorized
 */
export async function requireScope(
  event: RequestEvent,
  requiredScope: Scope,
  options?: {
    allowSelf?: boolean;
    targetUserId?: string;
  }
): Promise<AuthResult> {
  const { request, locals, cookies } = event;
  const { allowSelf = false, targetUserId } = options || {};

  if (requiredScope === 'public') {
    return {
      user: null,
      grantedScope: 'public',
      viaApiKey: false,
    };
  }

  const apiKey = request.headers.get('x-api-key') || request.headers.get('X-API-KEY');
  if (apiKey) {
    if (requiredScope === 'admin') {
      if (!verifyRawKeyWithScope(apiKey, 'admin')) {
        throw error(403, 'Admin scope required');
      }
      return {
        user: null,
        grantedScope: 'admin',
        viaApiKey: true,
      };
    }

    if (requiredScope === 'write') {
      if (!verifyRawKeyWithScope(apiKey, 'write') && !verifyRawKeyWithScope(apiKey, 'admin')) {
        throw error(403, 'Write or Admin scope required');
      }
      return {
        user: null,
        grantedScope: verifyRawKeyWithScope(apiKey, 'admin') ? 'admin' : 'write',
        viaApiKey: true,
      };
    }

    if (requiredScope === 'read') {
      if (
        !verifyRawKeyWithScope(apiKey, 'read') &&
        !verifyRawKeyWithScope(apiKey, 'write') &&
        !verifyRawKeyWithScope(apiKey, 'admin')
      ) {
        throw error(403, 'Read, Write or Admin scope required');
      }
      const grantedScope = verifyRawKeyWithScope(apiKey, 'admin')
        ? 'admin'
        : verifyRawKeyWithScope(apiKey, 'write')
          ? 'write'
          : 'read';

      // Log API key usage (only for mutating methods or admin scope to avoid flooding)
      if (request.method !== 'GET' || grantedScope === 'admin') {
        void logEvent(event, 'api_usage', 'api_key', `${apiKey.slice(0, 8)}...`, {
          method: request.method,
          path: event.url.pathname,
          scope: grantedScope,
        });
      }

      return {
        user: null,
        grantedScope: grantedScope as Scope,
        viaApiKey: true,
      };
    }
  }

  const user = await getCurrentUser({ locals, cookies });
  if (!user) {
    throw error(401, 'Authentication required');
  }

  if (requiredScope === 'admin') {
    const adminUser = await ensureAdmin({ locals, cookies });
    if (!adminUser) {
      throw error(403, 'Admin role required');
    }
    return {
      user: adminUser,
      grantedScope: 'admin',
      viaApiKey: false,
    };
  }

  if (allowSelf && targetUserId && user.id_user === targetUserId) {
    return {
      user,
      grantedScope: 'write',
      viaApiKey: false,
    };
  }

  return {
    user,
    grantedScope: requiredScope,
    viaApiKey: false,
  };
}

/**
 * Authorises a change to the albums themselves - creating, editing or deleting one, its photos,
 * its cover, its permissions. That is the gallery staff's work: a session must hold the `admin` or
 * `mitviste` role (the roles the pages show these controls to), and a key must hold the `write`
 * scope. `requireScope(event, 'write')` alone answers "is this a signed-in member", which is the
 * right question for a member's OWN data (favourites, their uploads) and not for an album.
 *
 * @throws 401 with no session and no key, 403 for a member who is not staff or a key without `write`
 */
export async function requireStaff(event: RequestEvent): Promise<AuthResult> {
  const auth = await requireScope(event, 'write');
  if (auth.viaApiKey || isStaffRole(auth.user?.role)) {
    return auth;
  }
  log.warn('album change refused: not staff', {
    viewer: auth.user?.id_user ?? null,
    method: event.request.method,
    path: event.url.pathname,
  });
  throw error(403, 'Staff role required');
}

/**
 * Simplified version for endpoints that require only a session
 * (no API key supported)
 */
export async function requireSession(event: RequestEvent): Promise<UserRow> {
  const user = await getCurrentUser({ locals: event.locals, cookies: event.cookies });
  if (!user) {
    throw error(401, 'Session required');
  }
  return user;
}

/**
 * Simplified version for admin endpoints (admin session only)
 */
export async function requireAdminSession(event: RequestEvent): Promise<UserRow> {
  const adminUser = await ensureAdmin({ locals: event.locals, cookies: event.cookies });
  if (!adminUser) {
    throw error(403, 'Admin session required');
  }
  return adminUser;
}
