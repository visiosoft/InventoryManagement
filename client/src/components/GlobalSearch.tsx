import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search, X } from 'lucide-react'
import { api } from '../lib/api'
import { tenantContractPath } from '../lib/tenantContract'

type ContractHit = {
  _id: string
  contractNo: string
  status: string
  startDate?: string
  endDate?: string
  customer?: { fullName?: string }
  unit?: { unitNumber?: string }
}

type CustomerHit = {
  _id: string
  fullName: string
  clientId?: string
  phone?: string
  phones?: string[]
  email?: string
}

/** A flat list so the keyboard can move across both groups. */
type Row =
  | { kind: 'contract'; id: string; title: string; meta: string; tag: string }
  | { kind: 'customer'; id: string; title: string; meta: string; tag: string }

const PURPLE = '#5B2BC9'
const MUTED = '#756E80'

/** Search tenants, contract numbers and units; picking a result opens the contract. */
export default function GlobalSearch() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Wait for a pause in typing so each keystroke doesn't hit the API
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250)
    return () => clearTimeout(t)
  }, [term])

  // Contracts and tenants are searched together: a tenant with no contract yet
  // still needs to be findable.
  const { data, isFetching } = useQuery<{ contracts: ContractHit[]; customers: CustomerHit[] }>({
    queryKey: ['global-search', debounced],
    queryFn: async () => {
      const [contracts, customers] = await Promise.all([
        api.get('/contracts/search', { params: { q: debounced, limit: 12 } }).then(r => r.data as ContractHit[]),
        api.get('/customers', { params: { search: debounced, limit: 5 } })
          .then(r => (Array.isArray(r.data) ? r.data : r.data?.data ?? []) as CustomerHit[]),
      ])
      return { contracts, customers }
    },
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  })

  // One row per contract — a tenant with two contracts is listed twice, each
  // row opening its own contract. Rows for the same tenant sit together.
  const shortDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : ''
  const contractRows: Row[] = (data?.contracts ?? [])
    .slice()
    .sort((a, b) => (a.customer?.fullName || '').localeCompare(b.customer?.fullName || ''))
    .map(c => ({
      kind: 'contract' as const,
      id: c._id,
      title: c.customer?.fullName || 'Unknown tenant',
      meta: [
        c.unit?.unitNumber ? `Unit ${c.unit.unitNumber}` : 'No unit',
        c.status.replace(/_/g, ' '),
        c.startDate && c.endDate ? `${shortDate(c.startDate)} – ${shortDate(c.endDate)}` : '',
      ].filter(Boolean).join(' · '),
      tag: c.contractNo,
    }))

  // Skip tenants already shown by one of their contracts
  const shownNames = new Set(contractRows.map(r => r.title.toLowerCase()))
  const customerRows: Row[] = (data?.customers ?? [])
    .filter(c => !shownNames.has((c.fullName || '').toLowerCase()))
    .map(c => ({
      kind: 'customer' as const,
      id: c._id,
      title: c.fullName,
      meta: [c.phones?.[0] || c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details',
      tag: c.clientId || 'Tenant',
    }))

  const results: Row[] = [...contractRows, ...customerRows]

  useEffect(() => { setActive(0) }, [debounced, data])

  // Close when clicking elsewhere
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Ctrl/Cmd+K focuses search from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function go(row: Row) {
    setOpen(false)
    setTerm('')
    inputRef.current?.blur()
    if (row.kind === 'contract') {
      navigate(`/contracts/${row.id}`)
      return
    }
    // Tenants have no page of their own — go to their contract instead
    navigate(await tenantContractPath(row.id, row.title))
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
  }

  const showPanel = open && debounced.length >= 2

  return (
    <div ref={boxRef} className="relative" style={{ width: 320 }}>
      <div className="flex items-center gap-2 h-9 px-3 rounded-full border bg-white"
        style={{ borderColor: 'rgba(20,8,31,.16)' }}>
        <Search size={14} style={{ color: MUTED }} />
        <input
          ref={inputRef}
          value={term}
          onChange={e => { setTerm(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search tenant, phone, contract no, unit…"
          className="flex-1 bg-transparent outline-none text-[13px]"
          style={{ color: '#14081F' }}
        />
        {isFetching && debounced.length >= 2 && <Loader2 size={13} className="animate-spin" style={{ color: MUTED }} />}
        {term && !isFetching && (
          <button type="button" onClick={() => { setTerm(''); inputRef.current?.focus() }}
            className="cursor-pointer" style={{ color: MUTED }}>
            <X size={13} />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 mt-1 rounded-xl border bg-white shadow-lg overflow-hidden z-50"
          style={{ borderColor: 'rgba(20,8,31,.12)', maxHeight: 380, overflowY: 'auto' }}>
          {results.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px]" style={{ color: MUTED }}>
              {isFetching ? 'Searching…' : `No tenant or contract matches “${debounced}”`}
            </p>
          ) : results.map((row, i) => {
            const firstOfKind = i === 0 || results[i - 1].kind !== row.kind
            return (
              <div key={`${row.kind}-${row.id}`}>
                {firstOfKind && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: MUTED, background: '#FAF8FD' }}>
                    {row.kind === 'contract' ? 'Contracts' : 'Tenants'}
                  </div>
                )}
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(row)}
                  className="w-full text-left px-4 py-2.5 cursor-pointer"
                  style={{ background: i === active ? '#F7F3FF' : '#fff' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-semibold truncate" style={{ color: '#14081F' }}>
                      {row.title}
                    </span>
                    <span className="text-[11px] font-semibold shrink-0" style={{ color: PURPLE }}>
                      {row.tag}
                    </span>
                  </div>
                  <div className="text-[11px] mt-0.5 truncate" style={{ color: MUTED }}>{row.meta}</div>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
