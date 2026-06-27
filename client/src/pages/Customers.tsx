import { useEffect, useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { FileText, FileBadge, Receipt, Plus, Search, Trash2, UserCheck, Merge } from 'lucide-react'
import { api, apiError, customerApi } from '../lib/api'
import type { Customer } from '../lib/types'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Pagination, Spinner, Table, Td, Th } from '../components/ui'
import { AddCustomerModal } from '../components/AddCustomerModal'
import { formatDate } from '../lib/utils'

// Re-export CustomerForm so existing imports (e.g. CustomerDetail) keep working
export { CustomerForm } from '../components/AddCustomerModal'

export default function Customers() {
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [sort, setSort]   = useState('date_added_desc')
  const [page, setPage]   = useState(1)
  const [limit, setLimit] = useState(25)
  const [adding, setAdding] = useState(false)
  const [prefill, setPrefill] = useState<Partial<Customer> | null>(null)
  const [newCustomer, setNewCustomer] = useState<Customer | null>(null)
  const [actionError, setActionError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Merge state
  const [mergeSource, setMergeSource] = useState<Customer | null>(null)
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeTarget, setMergeTarget] = useState<Customer | null>(null)
  const mergeSearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const p = (location.state as { prefill?: Partial<Customer> } | null)?.prefill
    if (p) {
      setPrefill(p)
      setAdding(true)
      window.history.replaceState({}, '')
    }
  }, [location.state])

  useEffect(() => { setPage(1) }, [search, sort, limit])

  type PagedCustomers = { data: Customer[]; total: number; page: number; pages: number; limit: number }
  const { data, isLoading } = useQuery<PagedCustomers>({
    queryKey: ['customers', search, sort, page, limit],
    queryFn: () => api.get('/customers', { params: { search, sort, page, limit } }).then((r) => r.data),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
  const customers = data?.data ?? []

  // Clear selection when page/search changes
  useEffect(() => { setSelected(new Set()) }, [search, sort, page])

  const allPageIds = customers.map((c) => c._id)
  const allSelected = allPageIds.length > 0 && allPageIds.every((id) => selected.has(id))

  function toggleAll() {
    if (allSelected) {
      setSelected((s) => { const n = new Set(s); allPageIds.forEach((id) => n.delete(id)); return n })
    } else {
      setSelected((s) => { const n = new Set(s); allPageIds.forEach((id) => n.add(id)); return n })
    }
  }

  function toggleOne(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const bulkDelete = useMutation({
    mutationFn: () => customerApi.bulkDelete([...selected]),
    onSuccess: (data) => {
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['customers'] })
      if (data.skipped > 0) setActionError(`${data.deleted} deleted. ${data.skipped} skipped (have contracts).`)
      else setActionError('')
    },
    onError: (e) => setActionError(apiError(e)),
  })

  // Search for merge target (debounced via query)
  const { data: mergeResults } = useQuery<{ data: Customer[] }>({
    queryKey: ['customers-merge-search', mergeSearch],
    queryFn: () => api.get('/customers', { params: { search: mergeSearch, limit: 8 } }).then((r) => r.data),
    enabled: mergeSearch.length > 1,
    staleTime: 10_000,
  })

  const doMerge = useMutation({
    mutationFn: () => customerApi.mergeInto(mergeSource!._id, mergeTarget!._id),
    onSuccess: (data) => {
      setMergeSource(null)
      setMergeTarget(null)
      setMergeSearch('')
      qc.invalidateQueries({ queryKey: ['customers'] })
      setActionError(`Merged "${data.deletedCustomer}" into "${data.intoCustomer}". ${data.invoicesMoved} invoice(s) moved.`)
    },
    onError: (e) => setActionError(apiError(e)),
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
        subtitle={data ? `${data.total} customer${data.total !== 1 ? 's' : ''}` : ''}
        action={
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <Button
                variant="destructive"
                onClick={() => { if (confirm(`Delete ${selected.size} selected customer(s)? Customers with contracts will be skipped.`)) bulkDelete.mutate() }}
                disabled={bulkDelete.isPending}
              >
                <Trash2 size={14} /> {bulkDelete.isPending ? 'Deleting…' : `Delete selected (${selected.size})`}
              </Button>
            )}
            <Button onClick={() => { setPrefill(null); setAdding(true) }}><Plus size={15} /> Add customer</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, phone, nationality, email, client ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full md:w-56">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
          >
            <option value="date_added_desc">Date added: newest first</option>
            <option value="date_added_asc">Date added: oldest first</option>
            <option value="name_asc">Name: A to Z</option>
            <option value="name_desc">Name: Z to A</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          {actionError && <p className="px-4 pt-4 text-xs text-destructive">{actionError}</p>}
          <Table>
            <thead>
              <tr>
                <Th className="w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="cursor-pointer" />
                </Th>
                <Th>Name</Th><Th>Client ID</Th><Th>Email</Th><Th>Phone</Th><Th>Nationality</Th><Th>Since</Th><Th />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c._id} className={`hover:bg-muted/50 ${selected.has(c._id) ? 'bg-muted/30' : ''}`}>
                  <Td>
                    <input type="checkbox" checked={selected.has(c._id)} onChange={() => toggleOne(c._id)} className="cursor-pointer" />
                  </Td>
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
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => { setMergeSource(c); setMergeTarget(null); setMergeSearch(''); setTimeout(() => mergeSearchRef.current?.focus(), 50) }}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                      >
                        <Merge size={12} /> Merge
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteCustomer(c)}
                        disabled={deletingId === c._id}
                        className="inline-flex items-center gap-1 text-xs text-destructive hover:underline disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {customers.length === 0 && <EmptyState message="No customers yet. Add your first customer." />}
          {data && data.pages > 1 && (
            <Pagination page={data.page} pages={data.pages} total={data.total} limit={limit}
              onPage={setPage} onLimit={setLimit} />
          )}
        </Card>
      )}

      {/* ── Merge customer modal ── */}
      <Modal
        open={!!mergeSource}
        onClose={() => { setMergeSource(null); setMergeTarget(null); setMergeSearch('') }}
        title="Merge customer"
      >
        {mergeSource && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground mb-0.5">Merging (will be deleted)</p>
              <p className="font-semibold">{mergeSource.fullName}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Search for the real customer to merge into:</p>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={mergeSearchRef}
                  className="pl-9"
                  placeholder="Type name to search…"
                  value={mergeSearch}
                  onChange={(e) => { setMergeSearch(e.target.value); setMergeTarget(null) }}
                />
              </div>

              {mergeSearch.length > 1 && (
                <div className="rounded-lg border divide-y max-h-52 overflow-y-auto bg-background">
                  {(mergeResults?.data ?? [])
                    .filter((c) => c._id !== mergeSource._id)
                    .map((c) => (
                      <button
                        key={c._id}
                        type="button"
                        onClick={() => setMergeTarget(c)}
                        className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted/60 cursor-pointer transition-colors ${mergeTarget?._id === c._id ? 'bg-primary/10 font-semibold' : ''}`}
                      >
                        <span>{c.fullName}</span>
                        {c.clientId && <span className="ml-2 text-xs text-muted-foreground">{c.clientId}</span>}
                      </button>
                    ))}
                  {(mergeResults?.data ?? []).filter((c) => c._id !== mergeSource._id).length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No customers found</p>
                  )}
                </div>
              )}
            </div>

            {mergeTarget && (
              <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40 p-3 text-sm">
                <p className="text-xs text-muted-foreground mb-0.5">Merge into (kept)</p>
                <p className="font-semibold">{mergeTarget.fullName}</p>
              </div>
            )}

            {doMerge.isError && <p className="text-xs text-destructive">{apiError(doMerge.error)}</p>}

            <Button
              className="w-full"
              disabled={!mergeTarget || doMerge.isPending}
              onClick={() => {
                if (confirm(`Merge "${mergeSource.fullName}" into "${mergeTarget!.fullName}"? All invoices will move and the stub will be deleted.`))
                  doMerge.mutate()
              }}
            >
              <Merge size={14} /> {doMerge.isPending ? 'Merging…' : 'Confirm merge'}
            </Button>
          </div>
        )}
      </Modal>

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
