import { stageDetails } from '../lib/leadTransitions'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiError, leadApi } from '../lib/api'
import { toDubaiDatetimeLocal } from '../lib/timezone'
import { Button, Field, Input, Modal, Select, Spinner, Textarea, statusLabel } from './ui'

const LOSS_REASONS = ['price', 'timing', 'competitor', 'no_response', 'not_a_fit', 'other']

export function LeadStageFields({ status, lead }: { status: string; lead?: { lossReason?: string; lossCompetitor?: string; reopenAt?: string | null; followUpAt?: string | null; siteVisitAt?: string | null; followUpNote?: string } }) {
  return <>
    {status === 'lost' && <>
      <Field label="Loss reason"><Select aria-label="Loss reason" name="lossReason" required defaultValue={lead?.lossReason || ''}><option value="">Choose a reason</option>{LOSS_REASONS.map(reason => <option key={reason} value={reason}>{statusLabel(reason)}</option>)}</Select></Field>
      <Field label="Competitor (optional)"><Input aria-label="Competitor" name="lossCompetitor" maxLength={200} defaultValue={lead?.lossCompetitor} /></Field>
      <Field label="Revisit on (optional, Dubai time)"><Input aria-label="Revisit on (Dubai time)" name="reopenAt" type="datetime-local" defaultValue={toDubaiDatetimeLocal(lead?.reopenAt || undefined)} /></Field>
      <p className="text-xs text-gray-500">A revisit date adds this lead to the Revisit due filter when it is due. It does not reopen the lead automatically.</p>
    </>}
    {status === 'follow_up_scheduled' && <>
      <Field label="Follow-up date and time (Dubai)"><Input aria-label="Follow-up date and time (Dubai)" name="followUpAt" type="datetime-local" required defaultValue={toDubaiDatetimeLocal(lead?.followUpAt || undefined)} /></Field>
      <Field label="Next action"><Input aria-label="Next action" name="followUpNote" placeholder="For example: call to discuss the quotation" maxLength={500} defaultValue={lead?.followUpNote} /></Field>
    </>}
    {status === 'site_visit_scheduled' && <Field label="Site visit date and time (Dubai)"><Input aria-label="Site visit date and time (Dubai)" name="siteVisitAt" type="datetime-local" required defaultValue={toDubaiDatetimeLocal(lead?.siteVisitAt || undefined)} /></Field>}
  </>
}


export default function LeadStageDialog({ leadId, nextStatus, expectedStatus, onClose, onSaved }: {
  leadId: string; nextStatus: string; expectedStatus?: string; onClose: () => void; onSaved?: () => void
}) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['lead-stage', leadId], queryFn: () => leadApi.get(leadId), staleTime: 0 })
  const mutation = useMutation({
    mutationFn: (form: FormData) => leadApi.updateStatus(leadId, nextStatus, String(form.get('comment') || ''), {
      ...stageDetails(form), expectedStatus: query.data?.status, expectedUpdatedAt: query.data?.updatedAt,
    }),
    onSuccess: async () => {
      await Promise.all(['leads', 'lead-stats', 'lead-funnel', 'leads-nav-order', 'lead', 'person', 'follow-up-detail', 'follow-up-queue', 'lead-stage'].map(key => qc.invalidateQueries({ queryKey: [key] })))
      onSaved?.()
      onClose()
    },
  })
  const lead = query.data
  const stale = expectedStatus !== undefined && lead && expectedStatus !== lead.status
  const missingOwner = lead && !lead.owner && ['follow_up_scheduled', 'site_visit_scheduled'].includes(nextStatus)
  return <Modal open onClose={() => { if (!mutation.isPending) onClose() }} title={`Move to ${statusLabel(nextStatus)}`}>
    {query.isPending ? <Spinner /> : query.isError ? <p role="alert">{apiError(query.error)} <button onClick={() => query.refetch()} className="underline">Retry</button></p> : lead && <form className="space-y-4" onSubmit={event => { event.preventDefault(); mutation.mutate(new FormData(event.currentTarget)) }}>
      <p className="text-sm"><strong>{lead.fullName}</strong> · currently {statusLabel(lead.status)}</p>
      {stale && <p role="alert" className="text-sm text-amber-700">This lead changed since you selected it. Close this dialog and refresh before moving it.</p>}
      {missingOwner && <p role="alert" className="text-sm text-amber-700">Assign an owner on the lead profile before scheduling an action.</p>}
      <LeadStageFields status={nextStatus} lead={lead} />
      <Field label="Comment (optional)"><Textarea aria-label="Comment" name="comment" maxLength={2000} rows={3} /></Field>
      {mutation.isError && <p role="alert" className="text-sm text-red-700">{apiError(mutation.error)} <button type="button" className="underline" onClick={() => { mutation.reset(); query.refetch() }}>Refresh lead</button></p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>Cancel</Button><Button type="submit" disabled={mutation.isPending || Boolean(stale) || Boolean(missingOwner)}>{mutation.isPending ? 'Saving…' : 'Save stage'}</Button></div>
    </form>}
  </Modal>
}
