import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, Search } from 'lucide-react'
import { api } from '../lib/api'
import { Card, CardBody, PageHeader, Pagination, Spinner } from '../components/ui'
import { ExportButtons, type ExportColumn } from '../components/ExportButtons'

const INK = '#14081F'
const MUTED = '#756E80'
const LINE = 'rgba(20,8,31,.10)'
const CHIP_BG = '#F3F0EA'

type AuditRow = {
  _id: string
  userName: string
  userEmail: string
  action: string
  entity: string
  entityId: string
  method: string
  path: string
  ipAddress: string
  detail: string
  createdAt: string
}

type Paged = {
  data: AuditRow[]
  total: number
  page: number
  pages: number
  limit: number
  entities: string[]
  actions: string[]
}

const ACTION_TONE: Record<string, { bg: string; fg: string }> = {
  created: { bg: '#DCFCE7', fg: '#047857' },
  updated: { bg: '#EFF6FF', fg: '#1D4ED8' },
  deleted: { bg: '#FEE2E2', fg: '#B91C1C' },
}

function actionTone(action: string) {
  return ACTION_TONE[action] || (action.startsWith('updated') ? ACTION_TONE.updated : { bg: CHIP_BG, fg: MUTED })
}

export default function AuditLogReport() {
  const [q, setQ] = useState('')
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery<Paged>({
    queryKey: ['audit-log', q, entity, action, from, to, page],
    queryFn: () => api.get('/audit-log', {
      params: {
        q: q || undefined, entity: entity || undefined, action: action || undefined,
        from: from || undefined, to: to || undefined, page, limit: 50,
      },
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
  })

  const rows = data?.data ?? []

  const exportColumns: ExportColumn[] = [
    { label: 'When' }, { label: 'Who' }, { label: 'Action' }, { label: 'Entity' },
    { label: 'Record' }, { label: 'IP address' }, { label: 'Method' }, { label: 'Path' },
  ]

  async function fetchAllForExport() {
    const { data: all } = await api
      .get('/audit-log', { params: { q: q || undefined, entity: entity || undefined, action: action || undefined, from: from || undefined, to: to || undefined, page: 1, limit: 500 } })
      .then((r) => r.data as Paged)
    return all.map((r): (string | number | null)[] => [
      new Date(r.createdAt).toLocaleString(),
      r.userName || 'Public', r.action, r.entity, r.entityId, r.ipAddress, r.method, r.path,
    ])
  }

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Audit log"
        subtitle="Every create, edit and delete across the app — who did it, and from where"
      />

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:flex-wrap">
        <div
          style={{ background: CHIP_BG, borderRadius: 10, height: 36 }}
          className="relative flex items-center max-w-sm flex-1 px-3"
        >
          <Search size={15} style={{ color: MUTED }} className="shrink-0" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
            placeholder="Search by person, record id, or path…"
            style={{ background: 'transparent', color: INK, fontSize: 13, outline: 'none', border: 'none' }}
            className="ml-2 w-full placeholder:text-[#756E80]"
          />
        </div>

        {(data?.entities?.length ?? 0) > 0 && (
          <select
            value={entity}
            onChange={(e) => { setEntity(e.target.value); setPage(1) }}
            style={{ background: CHIP_BG, borderRadius: 10, height: 36, border: 'none', outline: 'none', fontSize: 12.5, color: INK, padding: '0 10px' }}
            className="cursor-pointer"
          >
            <option value="">All records</option>
            {data!.entities.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        )}

        {(data?.actions?.length ?? 0) > 0 && (
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1) }}
            style={{ background: CHIP_BG, borderRadius: 10, height: 36, border: 'none', outline: 'none', fontSize: 12.5, color: INK, padding: '0 10px' }}
            className="cursor-pointer"
          >
            <option value="">All actions</option>
            {data!.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}

        <input
          type="date"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(1) }}
          style={{ background: CHIP_BG, borderRadius: 10, height: 36, border: 'none', outline: 'none', fontSize: 12.5, color: INK, padding: '0 10px' }}
        />
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => { setTo(e.target.value); setPage(1) }}
          style={{ background: CHIP_BG, borderRadius: 10, height: 36, border: 'none', outline: 'none', fontSize: 12.5, color: INK, padding: '0 10px' }}
        />

        <div className="ml-auto">
          <ExportButtons
            title="Audit log"
            subtitle={[q, entity, action].filter(Boolean).join(' · ')}
            columns={exportColumns}
            rows={rows.length ? [[]] : []}
            getRows={fetchAllForExport}
            total={data?.total ?? rows.length}
          />
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <CardBody className="py-14 text-center">
            <ShieldCheck size={30} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm text-muted-foreground">
              {q || entity || action || from || to ? 'Nothing matches that.' : 'Nothing logged yet.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <div className="divide-y" style={{ borderColor: LINE }}>
            {rows.map((r) => {
              const tone = actionTone(r.action)
              return (
                <div key={r._id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 shrink-0"
                      style={{ background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700 }}
                    >
                      {r.action}
                    </span>
                    <span className="font-semibold text-[13.5px]" style={{ color: INK }}>{r.entity}</span>
                    {r.entityId && (
                      <span style={{ fontSize: 12, color: MUTED, fontFamily: 'monospace' }}>{r.entityId}</span>
                    )}
                    <span className="ml-auto shrink-0" style={{ fontSize: 11.5, color: MUTED }}>
                      {new Date(r.createdAt).toLocaleString(undefined, {
                        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1" style={{ fontSize: 12, color: MUTED }}>
                    <span>{r.userName || 'Public'}</span>
                    {r.ipAddress && <span>from {r.ipAddress}</span>}
                    <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.method} {r.path}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {(data?.pages ?? 1) > 1 && (
        <Pagination page={data!.page} pages={data!.pages} total={data!.total} limit={50} onPage={setPage} />
      )}
    </div>
  )
}
