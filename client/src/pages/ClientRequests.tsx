import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { Search } from 'lucide-react'
import { apiError } from '../lib/api'
import { cn } from '../lib/utils'
import {
  CR_STATUSES, CR_TYPES, STATUS_LABEL, STATUS_TONE, TEAM_LABEL, TYPE_LABEL, TYPE_TONE,
  crApi, crListKey, dueLabel, isClosed, useClientRequestCounts,
  type CrRow, type CrScope, type CrStatus, type CrType,
} from '../lib/clientRequests'
import { Badge, Card, EmptyState, Input, PageHeader, Pagination, Select, Skeleton, Table, Td, Th } from '../components/ui'
import ClientRequestDrawer from '../components/ClientRequestDrawer'

const SCOPES: Array<{ key: CrScope; label: string }> = [
  { key: 'mine', label: 'Mine' },
  { key: 'team', label: 'My team' },
  { key: 'all', label: 'All' },
  { key: 'done', label: 'Done' },
]

const EMPTY: Record<CrScope, string> = {
  mine: 'Nothing assigned to you. Claim something from My team.',
  team: 'Nothing open for your team right now.',
  all: 'No open client requests.',
  done: 'Nothing closed yet.',
}

const LIMIT = 25

export default function ClientRequests() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const scope = (SCOPES.some(s => s.key === params.get('scope')) ? params.get('scope') : 'mine') as CrScope
  const type = params.get('type') || ''
  const status = params.get('status') || ''
  const q = params.get('q') || ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [search, setSearch] = useState(q)

  /** Change one or more filters; anything but paging starts again on page 1. */
  function update(next: Record<string, string | number | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '' || (k === 'page' && v === 1)) p.delete(k)
      else p.set(k, String(v))
    }
    if (!('page' in next)) p.delete('page')
    setParams(p, { replace: true })
  }

  // Debounced search: the URL (and the query) follows the box after a pause.
  useEffect(() => {
    if (search === q) return
    const t = setTimeout(() => update({ q: search.trim() || null }), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const { data: counts } = useClientRequestCounts()
  const listParams = { scope, type, status, q, page, limit: LIMIT }
  const { data, isLoading, error } = useQuery({
    queryKey: crListKey(listParams),
    queryFn: () => crApi.list(listParams),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: (n, e) => !(axios.isAxiosError(e) && [403, 404].includes(e.response?.status ?? 0)) && n < 1,
  })

  const items = useMemo(() => data?.items ?? [], [data])
  const forbidden = axios.isAxiosError(error) && error.response?.status === 403
  const notDeployed = axios.isAxiosError(error) && error.response?.status === 404

  const search_ = params.toString()
  const open = (rowId: string) => navigate({ pathname: `/client-requests/${rowId}`, search: search_ ? `?${search_}` : '' })
  const close = () => navigate({ pathname: '/client-requests', search: search_ ? `?${search_}` : '' })

  const idx = id ? items.findIndex(r => r.id === id) : -1
  const prevId = idx > 0 ? items[idx - 1].id : null
  const nextId = idx >= 0 && idx < items.length - 1 ? items[idx + 1].id : null

  const scopeCount = (s: CrScope) => (s === 'mine' ? counts?.mine : s === 'team' ? counts?.team : undefined) ?? 0

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Client requests"
        subtitle="Everything customers ask for in the app, in one place: claim it, act on it, and the customer hears back."
        action={counts && counts.overdue > 0
          ? <Badge tone="red">{counts.overdue} overdue</Badge>
          : undefined}
      />

      <div className="flex gap-1 border-b overflow-x-auto scrollbar-none">
        {SCOPES.map(({ key, label }) => {
          const n = scopeCount(key)
          const active = scope === key
          return (
            <button key={key} onClick={() => update({ scope: key === 'mine' ? null : key })}
              className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5 whitespace-nowrap cursor-pointer',
                active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border')}>
              {label}
              {n > 0 && (
                <span className={cn('text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{n}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={type} onChange={e => update({ type: e.target.value || null })} className="w-full sm:w-56">
          <option value="">All types</option>
          {CR_TYPES.map(t => {
            const n = counts?.byType?.[t]
            return <option key={t} value={t}>{TYPE_LABEL[t]}{n ? ` (${n})` : ''}</option>
          })}
        </Select>
        <Select value={status} onChange={e => update({ status: e.target.value || null })} className="w-full sm:w-48">
          <option value="">{scope === 'done' ? 'Any closed status' : 'Any open status'}</option>
          {CR_STATUSES.filter(s => (scope === 'done') === isClosed(s)).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ref, customer, phone, contract…" className="pl-8" />
        </div>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : forbidden ? (
          <EmptyState message="Client requests are handled by the warehouse, sales and accounts teams. Ask an admin to add you to one." />
        ) : notDeployed ? (
          <EmptyState message="Client requests are not switched on for this server yet." />
        ) : error ? (
          <p className="p-4 text-sm text-destructive">{apiError(error)}</p>
        ) : !items.length ? (
          <EmptyState message={q || type || status ? 'Nothing matches these filters.' : EMPTY[scope]} />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Ref</Th><Th>Type</Th><Th>Customer</Th><Th>Contract</Th><Th>Request</Th><Th>Due</Th><Th>Assignee</Th><Th>Status</Th></tr>
              </thead>
              <tbody>
                {items.map(r => <Row key={r.id} r={r} active={r.id === id} onOpen={() => open(r.id)} />)}
              </tbody>
            </Table>
            <Pagination page={page} pages={Math.ceil((data?.total ?? 0) / LIMIT)} total={data?.total ?? 0} limit={LIMIT}
              onPage={p => update({ page: p })} />
          </>
        )}
      </Card>

      <ClientRequestDrawer
        id={id ?? null}
        onClose={close}
        prevId={prevId}
        nextId={nextId}
        position={idx >= 0 ? `${(page - 1) * LIMIT + idx + 1} of ${data?.total ?? items.length}` : undefined}
        onNavigate={open}
      />
    </div>
  )
}

function Row({ r, active, onOpen }: { r: CrRow; active: boolean; onOpen: () => void }) {
  const closed = isClosed(r.status as CrStatus)
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <tr onClick={onOpen} className={cn('cursor-pointer hover:bg-muted/50', active && 'bg-muted/60')}>
      <Td className="whitespace-nowrap">
        <span className="font-mono text-xs">{r.ref}</span>
        {r.priority === 'high' && <Badge tone="red" className="ml-1.5">High</Badge>}
      </Td>
      <Td><Badge tone={TYPE_TONE[r.type as CrType] ?? 'gray'}>{TYPE_LABEL[r.type as CrType] ?? r.type}</Badge></Td>
      <Td className="whitespace-nowrap">
        {r.customer ? (
          <>
            <Link to={`/customers/${r.customer.id}`} onClick={stop} className="font-medium hover:underline">{r.customer.name}</Link>
            <div className="text-xs text-muted-foreground">{r.customer.phone}</div>
          </>
        ) : <span className="text-muted-foreground">—</span>}
      </Td>
      <Td className="whitespace-nowrap">
        {r.contract ? (
          <>
            <Link to={`/contracts/${r.contract.id}`} onClick={stop} className="font-mono text-xs hover:underline">{r.contract.contractNo}</Link>
            {r.contract.units.length > 0 && <div className="text-xs text-muted-foreground">{r.contract.units.join(', ')}</div>}
          </>
        ) : <span className="text-muted-foreground">—</span>}
      </Td>
      <Td className="max-w-[18rem]">
        <div className="truncate font-medium">{r.title}</div>
        {r.summary && <div className="truncate text-xs text-muted-foreground">{r.summary}</div>}
      </Td>
      <Td className="whitespace-nowrap">
        {closed ? <span className="text-muted-foreground">—</span> : (
          <span className={cn('text-xs', r.overdue ? 'text-destructive font-semibold' : 'text-muted-foreground')}>{dueLabel(r.dueAt, r.overdue)}</span>
        )}
        {r.escalatedAt && !closed && <div><Badge tone="red" className="mt-0.5">Escalated</Badge></div>}
      </Td>
      <Td className="whitespace-nowrap">
        {r.assignee ? r.assignee.name : <span className="text-muted-foreground">Unassigned</span>}
        <div className="text-[11px] text-muted-foreground">{TEAM_LABEL[r.team] ?? r.team}</div>
      </Td>
      <Td><Badge tone={STATUS_TONE[r.status as CrStatus] ?? 'gray'}>{STATUS_LABEL[r.status as CrStatus] ?? r.status}</Badge></Td>
    </tr>
  )
}
