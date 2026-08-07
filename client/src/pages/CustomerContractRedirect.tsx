import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { Contract, Customer } from '../lib/types'
import { Spinner } from '../components/ui'

/**
 * There is no standalone tenant page any more — everything about a tenant is
 * shown on their contract. This keeps every existing /customers/:id link (and
 * the global search) working by sending it on to that tenant's latest contract.
 * A tenant with no contract yet lands on the contracts list filtered by their
 * name, so the answer is still "here's their contract situation".
 */
export default function CustomerContractRedirect() {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading } = useQuery<{ contract?: Contract; name: string }>({
    queryKey: ['customer-latest-contract', id],
    queryFn: async () => {
      const [contracts, customer] = await Promise.all([
        api.get('/contracts', { params: { customer: id, limit: 1, archived: 'all' } }).then((r) => r.data?.data ?? []),
        api.get(`/customers/${id}`).then((r) => r.data as Customer).catch(() => null),
      ])
      return { contract: contracts[0], name: customer?.fullName || '' }
    },
    enabled: !!id,
  })

  if (isLoading) return <div className="p-8"><Spinner /></div>

  if (data?.contract) return <Navigate to={`/contracts/${data.contract._id}`} replace />
  return <Navigate to={data?.name ? `/contracts?search=${encodeURIComponent(data.name)}` : '/contracts'} replace />
}
