import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { FileText, FileBadge, Receipt, Plus, Search, Trash2, UserCheck } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { Customer } from '../lib/types'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Spinner, Table, Td, Th } from '../components/ui'
import { AddCustomerModal } from '../components/AddCustomerModal'
import { formatDate } from '../lib/utils'

// Re-export CustomerForm so existing imports (e.g. CustomerDetail) keep working
export { CustomerForm } from '../components/AddCustomerModal'

export default function Customers() {
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [prefill, setPrefill] = useState<Partial<Customer> | null>(null)
  const [newCustomer, setNewCustomer] = useState<Customer | null>(null)
  const [actionError, setActionError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    const p = (location.state as { prefill?: Partial<Customer> } | null)?.prefill
    if (p) {
      setPrefill(p)
      setAdding(true)
      window.history.replaceState({}, '')
    }
  }, [location.state])

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ['customers', search],
    queryFn: () => api.get('/customers', { params: { search } }).then((r) => r.data),
  })

  async function onDeleteCustomer(c: Customer) {
    if (!window.confirm(`Delete customer ${c.fullName}? This cannot be undone.`)) return
    setDeletingId(c._id)
    try {
      await api.delete(`/customers/${c._id}`)
      qc.invalidateQueries({ queryKey: ['customers'] })
      setActionError('')
    } catch (e) {
      setActionError(apiError(e))
    } finally {
      setDeletingId(null)
    }
  }

  function goTo(path: string) {
    setNewCustomer(null)
    navigate(path)
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${customers?.length ?? 0} customers`}
        action={<Button onClick={() => { setPrefill(null); setAdding(true) }}><Plus size={15} /> Add customer</Button>}
      />

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          {actionError && <p className="px-4 pt-4 text-xs text-destructive">{actionError}</p>}
          <Table>
            <thead><tr><Th>Name</Th><Th>Client ID</Th><Th>Email</Th><Th>Phone</Th><Th>Nationality</Th><Th>Since</Th><Th /></tr></thead>
            <tbody>
              {(customers || []).map((c) => (
                <tr key={c._id} className="hover:bg-muted/50">
                  <Td>
                    <Link to={`/customers/${c._id}`} className="font-medium text-primary hover:underline">{c.fullName}</Link>
                    {c.tenantType === 'company' && <span className="ml-1.5 text-[10px] text-muted-foreground">(Co.)</span>}
                  </Td>
                  <Td className="text-muted-foreground text-xs">{c.clientId || '—'}</Td>
                  <Td>{c.email || '—'}</Td>
                  <Td>{c.phones?.[0] ?? c.phone ?? '—'}</Td>
                  <Td>{c.nationality || '—'}</Td>
                  <Td>{formatDate(c.createdAt)}</Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      onClick={() => onDeleteCustomer(c)}
                      disabled={deletingId === c._id}
                      className="inline-flex items-center gap-1 text-xs text-destructive hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(customers || []).length === 0 && <EmptyState message="No customers yet. Add your first customer." />}
        </Card>
      )}

      {/* ── Add customer modal (shared component) ── */}
      <AddCustomerModal
        open={adding}
        onClose={() => { setAdding(false); setPrefill(null) }}
        onCreated={(customer) => { setPrefill(null); setNewCustomer(customer) }}
        initial={prefill ?? undefined}
      />

      {/* ── Post-creation "What next?" modal ── */}
      <Modal
        open={!!newCustomer}
        onClose={() => setNewCustomer(null)}
        title="Customer added"
        wide
      >
        {newCustomer && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-900/20">
              <UserCheck size={20} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="font-semibold text-sm">{newCustomer.fullName}</p>
                {newCustomer.clientId && <p className="text-xs text-muted-foreground">{newCustomer.clientId}</p>}
              </div>
            </div>

            <p className="text-sm text-muted-foreground">What would you like to do next?</p>

            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => goTo(`/contracts/new?customer=${newCustomer._id}`)}
                className="group rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md cursor-pointer">
                <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <FileText size={18} />
                </div>
                <p className="font-semibold text-sm">New contract</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Book a storage unit</p>
              </button>

              <button onClick={() => goTo(`/quotes/new?customer=${newCustomer._id}`)}
                className="group rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md cursor-pointer">
                <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <FileBadge size={18} />
                </div>
                <p className="font-semibold text-sm">New quote</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Send a price proposal</p>
              </button>

              <button onClick={() => goTo(`/invoices/new?customer=${newCustomer._id}`)}
                className="group rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md cursor-pointer">
                <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Receipt size={18} />
                </div>
                <p className="font-semibold text-sm">New invoice</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Bill the customer</p>
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <Link to={`/customers/${newCustomer._id}`} onClick={() => setNewCustomer(null)} className="text-xs text-primary hover:underline">
                View customer profile
              </Link>
              <Button variant="outline" onClick={() => setNewCustomer(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
