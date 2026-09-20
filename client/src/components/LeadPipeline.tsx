import LeadStageDialog from './LeadStageDialog'
import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import { apiError, leadApi, type LeadQuery } from '../lib/api'
import type { Lead, LeadStatus } from '../lib/types'
import { statusLabel } from './ui'
import { formatDateTime, formatMoney } from '../lib/utils'

const stages: LeadStatus[] = ['new', 'contact_attempted', 'contacted', 'site_visit_scheduled', 'follow_up_scheduled', 'quotation_sent', 'won', 'lost', 'already_customer']
type Filters = LeadQuery & { chase?: string; attemptBy?: string }
type CardProps = { lead: Lead; busy: boolean; onOpen: (id: string) => void; onMove: (lead: Lead, status: LeadStatus) => void }

function LeadCard({ lead, busy, onOpen, onMove }: CardProps) {
  const [now] = useState(() => Date.now())
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead._id, data: { lead }, disabled: busy })
  const overdue = lead.followUpAt && new Date(lead.followUpAt).getTime() < now && !['won', 'lost', 'already_customer'].includes(lead.status)
  return <article ref={setNodeRef} className={`rounded-xl border border-[#e5dfee] bg-white p-3 shadow-sm ${isDragging ? 'opacity-30' : ''}`}>
    <div className="flex items-start gap-2">
      <button type="button" onClick={() => onOpen(lead._id)} className="min-w-0 flex-1 text-left font-semibold text-[#14081F] hover:underline focus-visible:outline-2 focus-visible:outline-violet-600">{lead.fullName}</button>
      <button type="button" {...attributes} {...listeners} disabled={busy} aria-label={`Drag ${lead.fullName}; use Move to below for keyboard access`} className="touch-none rounded p-1 text-gray-500 cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-violet-600"><GripVertical size={18} /></button>
    </div>
    <p className="mt-1 text-xs text-gray-500">{statusLabel(lead.source)}{lead.temperature ? ` · ${statusLabel(lead.temperature)}` : ''}</p>
    <a href={`tel:${lead.phone}`} className="mt-3 block text-sm text-[#5B2BC9]">{lead.phone}</a>
    <p className="mt-2 text-xs text-gray-600">{lead.owner?.name || 'Unassigned'}</p>
    {lead.storageSizeValue > 0 && <p className="mt-1 text-xs text-gray-500">{lead.storageSizeValue} sqft · {lead.durationValue} {lead.durationUnit}</p>}
    {lead.followUpAt && <p className={`mt-2 text-xs ${overdue ? 'font-semibold text-red-700' : 'text-gray-500'}`}>{overdue ? 'Overdue' : 'Follow-up'} · {formatDateTime(lead.followUpAt)}</p>}
    {lead.quoteValue != null && <p className="mt-2 text-sm font-semibold tabular-nums text-[#5B2BC9]">AED {formatMoney(lead.quoteValue)} <span className="font-normal text-xs text-gray-500">{lead.quoteNo} ? {lead.quoteStatus}</span></p>}
    {lead.expectedCloseAt && <p className="mt-1 text-xs text-gray-500">Expected close ? {formatDateTime(lead.expectedCloseAt)}</p>}
    {lead.lossReason && lead.status === 'lost' && <p className="mt-2 text-xs text-gray-500">Lost ? {statusLabel(lead.lossReason)}{lead.lossCompetitor ? ` ? ${lead.lossCompetitor}` : ''}</p>}
    {lead.reopenAt && lead.status === 'lost' && <p className="mt-1 text-xs text-gray-500">Revisit ? {formatDateTime(lead.reopenAt)}</p>}
    <label className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-2 text-xs text-gray-500">Move to
      <select aria-label={`Move ${lead.fullName} to stage`} value={lead.status} disabled={busy} onChange={e => onMove(lead, e.target.value as LeadStatus)} className="min-w-0 flex-1 rounded border border-gray-200 bg-white p-1 text-gray-700 focus-visible:outline-2 focus-visible:outline-violet-600">
        {stages.map(stage => <option key={stage} value={stage}>{statusLabel(stage)}</option>)}
      </select>
    </label>
  </article>
}

function Stage({ stage, filters, busy, onOpen, onMove }: Omit<CardProps, 'lead'> & { stage: LeadStatus; filters: Filters }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: busy })
  const query = useInfiniteQuery({
    queryKey: ['leads', 'pipeline', filters, stage],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => leadApi.list({ ...filters, status: stage, page: pageParam, limit: 25 }),
    getNextPageParam: last => last.page < last.pages ? last.page + 1 : undefined,
  })
  const leads = query.data?.pages.flatMap(page => page.data) || []
  return <section ref={setNodeRef} aria-label={statusLabel(stage)} className={`min-h-[360px] w-[270px] shrink-0 rounded-2xl border p-3 ${isOver ? 'border-violet-500 bg-violet-100' : 'border-[#e5dfee] bg-[#f3f0f6]'}`}>
    <header className="mb-4 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-[#14081F]">{statusLabel(stage)}</h3><span className="rounded-md bg-white px-2 py-1 text-xs tabular-nums">{query.data?.pages[0]?.total ?? '—'}</span></header>
    <div className="max-h-[65vh] space-y-3 overflow-y-auto overscroll-contain">
      {query.isPending && <p role="status" className="p-4 text-sm text-gray-500">Loading leads…</p>}
      {query.isError && <div role="alert" className="text-sm text-red-700">{apiError(query.error)} <button onClick={() => query.refetch()} className="underline">Retry</button></div>}
      {leads.map(lead => <LeadCard key={lead._id} lead={lead} busy={busy} onOpen={onOpen} onMove={onMove} />)}
      {query.isSuccess && !leads.length && <p className="rounded-xl border border-dashed border-gray-300 px-3 py-8 text-center text-xs text-gray-500">No matching leads. Drop a lead here to move it.</p>}
      {query.hasNextPage && <button disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-medium">{query.isFetchingNextPage ? 'Loading…' : `Load more · ${leads.length} shown`}</button>}
    </div>
  </section>
}

export default function LeadPipeline({ filters, onOpen }: { filters: Filters; onOpen: (id: string) => void }) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<{ lead: Lead; status: LeadStatus } | null>(null)
  const [active, setActive] = useState<Lead | null>(null)
  const [message, setMessage] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const mutation = useMutation({
    mutationFn: ({ lead, status }: { lead: Lead; status: LeadStatus }) => leadApi.updateStatus(lead._id, status, undefined, { expectedStatus: lead.status, expectedUpdatedAt: lead.updatedAt }),
    onSuccess: async (_, { lead, status }) => {
      setMessage(`${lead.fullName} moved to ${statusLabel(status)}.`)
      await Promise.all(['leads', 'lead-stats', 'lead-funnel', 'leads-nav-order', 'lead', 'person', 'lead-stage'].map(key => qc.invalidateQueries({ queryKey: [key] })))
    },
  })
  function move(lead: Lead, status: LeadStatus) {
    if (mutation.isPending || lead.status === status) return
    if (['lost', 'follow_up_scheduled', 'site_visit_scheduled'].includes(status)) { setPending({ lead, status }); return }
    setMessage('')
    mutation.mutate({ lead, status })
  }
  return <div className="mb-5">
    <div className="mb-3 text-sm text-gray-600">Drag a card by its handle, or use its Move to menu. Simple stage changes save automatically. Scheduling and loss moves ask for details.</div>
    <p role="status" className="mb-2 text-sm text-[#5B2BC9]">{mutation.isPending ? 'Saving stage…' : message}</p>
    {mutation.isError && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">Could not move lead: {apiError(mutation.error)}. Refresh the board before trying again.</p>}
    {pending && <LeadStageDialog leadId={pending.lead._id} expectedStatus={pending.lead.status} nextStatus={pending.status} onClose={() => setPending(null)} onSaved={() => setMessage(`${pending.lead.fullName} moved to ${statusLabel(pending.status)}.`)} />}
    <DndContext sensors={sensors} onDragStart={event => setActive(event.active.data.current?.lead || null)} onDragCancel={() => setActive(null)} onDragEnd={event => {
      setActive(null)
      const lead = event.active.data.current?.lead as Lead | undefined
      const target = event.over?.id as LeadStatus | undefined
      if (lead && target && stages.includes(target)) move(lead, target)
    }}>
      <div className="flex items-start gap-3 overflow-x-auto pb-4" aria-label="Lead pipeline">
        {stages.map(stage => <Stage key={stage} stage={stage} filters={filters} busy={mutation.isPending || Boolean(pending)} onOpen={onOpen} onMove={move} />)}
      </div>
      <DragOverlay>{active ? <div className="w-[244px] rounded-xl border border-violet-400 bg-white p-4 font-semibold shadow-lg">{active.fullName}</div> : null}</DragOverlay>
    </DndContext>
  </div>
}
