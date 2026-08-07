import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { Contract } from '../lib/types'
import { Spinner } from '../components/ui'

/**
 * There is no standalone tenant page any more — everything about a tenant is
 * shown on their contract. This keeps every existing /customers/:id link (and
 * the global search) working by sending it on to that tenant's latest contract,
 * or back to the tenant list when they have none yet.
 */
export default function CustomerContractRedirect() {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading } = useQuery<{ data: Contract[] }>({
    queryKey: ['customer-latest-contract', id],
    queryFn: () => api.get('/contracts', { params: { customer: id, limit: 1, archived: 'all' } }).then((r) => r.data),
    enabled: !!id,
  })

  if (isLoading) return <div className="p-8"><Spinner /></div>

  const contract = data?.data?.[0]
  return <Navigate to={contract ? `/contracts/${contract._id}` : '/customers'} replace />
}
