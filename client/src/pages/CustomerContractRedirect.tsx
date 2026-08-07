import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { Customer } from '../lib/types'
import { tenantContractPath } from '../lib/tenantContract'
import { Spinner } from '../components/ui'

/**
 * There is no standalone tenant page any more — everything about a tenant is
 * shown on their contract. This keeps every existing /customers/:id link
 * working by sending it on to that tenant's contract.
 */
export default function CustomerContractRedirect() {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading } = useQuery<string>({
    queryKey: ['tenant-contract-path', id],
    queryFn: async () => {
      const customer = await api.get(`/customers/${id}`).then((r) => r.data as Customer).catch(() => null)
      return tenantContractPath(id!, customer?.fullName || '')
    },
    enabled: !!id,
  })

  if (isLoading || !data) return <div className="p-8"><Spinner /></div>
  return <Navigate to={data} replace />
}
