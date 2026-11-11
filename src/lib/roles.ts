/**
 * The roles that run the gallery. One predicate, so the server guards that reserve a change to the
 * staff (`requireStaff`, the proxy's deletion rule) cannot drift apart.
 */

/** True for an administrator or a mitviste. */
export function isStaffRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'mitviste';
}
