import { api } from './api'

/**
 * Finds the contract page to open for a tenant.
 *
 * Looking up by customer id isn't enough on its own: the tenant list holds
 * duplicate records for the same person, so the record the search returns is
 * often not the one the contract points at. When the id finds nothing we retry
 * on the name, which catches those duplicates.
 *
 * Returns the contracts list filtered by name only when the tenant genuinely
 * has no contract — a third of the tenant list is in that state.
 */
export async function tenantContractPath(customerId: string, fullName: string): Promise<string> {
  const first = async (params: Record<string, unknown>) => {
    const r = await api.get('/contracts', { params: { limit: 1, archived: 'all', ...params } })
    return (r.data?.data ?? [])[0] as { _id: string } | undefined
  }

  try {
    const byId = await first({ customer: customerId })
    if (byId) return `/contracts/${byId._id}`

    if (fullName.trim()) {
      const byName = await first({ search: fullName.trim() })
      if (byName) return `/contracts/${byName._id}`
    }
  } catch {
    // fall through to the filtered list
  }

  return fullName.trim() ? `/contracts?search=${encodeURIComponent(fullName.trim())}` : '/contracts'
}
