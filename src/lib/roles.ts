/**
 * The roles that run the gallery. One predicate, so the server guards that reserve a change to the
 * staff (`requireStaff`, the proxy's deletion rule) cannot drift apart.
 */

/**
 * True for an administrator only. The role an impersonation is judged on: starting one, and keeping
 * one alive (`resolveSession` drops it once the real account is no longer an admin).
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin';
}

/** True for an administrator or a mitviste. */
export function isStaffRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'mitviste';
}
