/**
 * Roles that carry the sales rep's access.
 *
 * 'accounts' is a deliberate duplicate of 'sales_rep': same permissions, same
 * own-records-only data scope. It exists so the two teams can be told apart in
 * reporting, not to grant anything extra. Anywhere the app asks "is this a
 * sales rep?", ask this instead, so the two never drift.
 */
export const SALES_REP_ROLES = ['sales_rep', 'accounts'] as const

export function isSalesRepRole(role?: string): boolean {
  return role === 'sales_rep' || role === 'accounts'
}

export function roleLabel(role?: string): string {
  if (role === 'admin') return 'Admin'
  if (role === 'sales_rep') return 'Sales Rep'
  if (role === 'accounts') return 'Accounts'
  return 'Staff'
}
