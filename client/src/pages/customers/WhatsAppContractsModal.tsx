import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Check, MessageCircle } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { Modal, Spinner } from '../../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_DEEP = '#4A1FA0'
const PURPLE_TINT = '#F7F3FF'

export interface WhatsAppContractRow {
  contractId: string
  contractNo: string
  customerName: string
  phone: string
  unit?: string
  endDate?: string
}

type EmailTemplate = { _id: string; key?: string; label: string; whatsappTemplate?: string }

type SendResult = {
  sent: { contractId: string; contractNo: string; to: string }[]
  failed: { contractId: string; contractNo: string; customerName: string; reason: string }[]
  template: string
}

function initialsOf(name: string) {
  const parts = (name || '').trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

/**
 * WhatsApp's version of the Email customers composer.
 *
 * Deliberately narrower than that one: WhatsApp has no free-text broadcast
 * body to write — outside a 24-hour reply window it must go as an approved
 * template, verbatim, with only the numbered variables filled in per
 * recipient. So there is no editor here, only who and which template; the
 * server fills each contract's own @unit, @endDate and renewal link the same
 * way the single-contract "Send WhatsApp" button on a contract page already
 * does.
 *
 * Scoped to contracts, not customers, for the same reason: the placeholders
 * belong to one contract, and a tenant with two units gets two separate,
 * correctly-addressed messages rather than one that cannot say which unit it
 * means.
 */
export default function WhatsAppContractsModal({
  onClose,
  contracts,
  preselectTemplateKey,
}: {
  onClose: () => void
  /** The candidate recipients — already computed by whoever opened this
   *  (the assistant's compose_whatsapp tool, today). Rows with no phone
   *  number are shown but cannot be selected. */
  contracts: WhatsAppContractRow[]
  /** Template key (not id) to preselect, e.g. contract_expiring. */
  preselectTemplateKey?: string
}) {
  const withPhone = useMemo(() => contracts.filter((c) => c.phone), [contracts])
  const withoutPhone = useMemo(() => contracts.filter((c) => !c.phone), [contracts])

  const [selected, setSelected] = useState<Set<string>>(() => new Set(withPhone.map((c) => c.contractId)))
  const [templateId, setTemplateId] = useState('')
  const [result, setResult] = useState<SendResult | null>(null)
  const [error, setError] = useState('')

  const { data: templates = [], isLoading: loadingTemplates } = useQuery<EmailTemplate[]>({
    queryKey: ['message-templates', 'automation'],
    queryFn: () => api.get('/message-templates', { params: { kind: 'automation' } }).then((r) => r.data ?? []),
    staleTime: 60_000,
  })
  // Only templates somebody has actually mapped to an approved WhatsApp
  // template — the same gate the single-contract send button applies, so this
  // cannot offer to send something that would just fail per recipient.
  const waTemplates = useMemo(() => templates.filter((t) => t.whatsappTemplate), [templates])

  const templateApplied = useRef(false)
  useEffect(() => {
    if (templateApplied.current || !preselectTemplateKey || waTemplates.length === 0) return
    const t = waTemplates.find((x) => x.key === preselectTemplateKey)
    if (t) { templateApplied.current = true; setTemplateId(t._id) }
  }, [waTemplates, preselectTemplateKey])

  function toggleOne(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected((s) => (s.size === withPhone.length ? new Set() : new Set(withPhone.map((c) => c.contractId))))
  }

  const send = useMutation({
    mutationFn: () => api.post('/contracts/bulk-whatsapp-template', {
      contractIds: [...selected],
      templateId,
    }).then((r) => r.data as SendResult),
    onSuccess: (r) => { setError(''); setResult(r) },
    onError: (e) => setError(apiError(e)),
  })

  const selectedTemplate = waTemplates.find((t) => t._id === templateId)
  const sendDisabled = selected.size === 0 || !templateId || send.isPending

  return (
    <Modal open onClose={onClose} title="WhatsApp tenants" wide>
      {result ? (
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center rounded-full" style={{ width: 32, height: 32, background: '#DCFCE7', color: '#047857' }}>
              <Check size={17} />
            </span>
            <div>
              <p className="text-sm font-semibold" style={{ color: INK }}>
                Sent to {result.sent.length} of {result.sent.length + result.failed.length}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>Template: {result.template}</p>
            </div>
          </div>

          {result.failed.length > 0 && (
            <div className="rounded-lg border" style={{ borderColor: 'rgba(20,8,31,.1)' }}>
              <div className="px-3 py-2 text-xs font-semibold border-b" style={{ color: '#B45309', borderColor: 'rgba(20,8,31,.1)' }}>
                Not sent — {result.failed.length}
              </div>
              <div className="divide-y" style={{ borderColor: 'rgba(20,8,31,.06)' }}>
                {result.failed.map((f) => (
                  <div key={f.contractId} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                    <span style={{ color: INK }}>{f.customerName || f.contractNo}</span>
                    <span style={{ color: '#B91C1C' }}>{f.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="cursor-pointer text-sm font-semibold px-4 py-2 rounded-lg" style={{ background: PURPLE, color: '#fff' }}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: MUTED }}>Template</label>
            {loadingTemplates ? (
              <Spinner />
            ) : waTemplates.length === 0 ? (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#FFF7E6', color: '#8A5A00' }}>
                No template has an approved WhatsApp version yet. Add one to a template in Settings → Message Templates.
              </p>
            ) : (
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'rgba(20,8,31,.14)' }}
              >
                <option value="">Choose a template…</option>
                {waTemplates.map((t) => <option key={t._id} value={t._id}>{t.label}</option>)}
              </select>
            )}
            {selectedTemplate && (
              <p className="text-xs mt-1.5" style={{ color: MUTED }}>
                Sends as the approved template <strong style={{ color: INK }}>{selectedTemplate.whatsappTemplate}</strong> — the
                wording is fixed by Meta; only the name, unit and dates are filled in per person.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold" style={{ color: MUTED }}>
                Recipients — {selected.size} of {withPhone.length} selected
              </label>
              {withPhone.length > 0 && (
                <button type="button" onClick={toggleAll} className="cursor-pointer text-xs font-semibold" style={{ color: PURPLE_DEEP }}>
                  {selected.size === withPhone.length ? 'Clear all' : 'Select all'}
                </button>
              )}
            </div>
            <div className="rounded-lg border max-h-64 overflow-y-auto" style={{ borderColor: 'rgba(20,8,31,.14)' }}>
              {contracts.map((c) => {
                const has = Boolean(c.phone)
                const on = selected.has(c.contractId)
                return (
                  <label
                    key={c.contractId}
                    className={`flex items-center gap-3 px-3 py-2 border-b last:border-b-0 ${has ? 'cursor-pointer' : 'opacity-50'}`}
                    style={{ borderColor: 'rgba(20,8,31,.06)', background: on ? PURPLE_TINT : 'transparent' }}
                  >
                    <input type="checkbox" checked={on} disabled={!has} onChange={() => toggleOne(c.contractId)} />
                    <span className="grid place-items-center rounded-full shrink-0 text-xs font-bold" style={{ width: 28, height: 28, background: '#EDE5FF', color: PURPLE_DEEP }}>
                      {initialsOf(c.customerName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm truncate" style={{ color: INK }}>{c.customerName || c.contractNo}</span>
                      <span className="block text-xs truncate" style={{ color: MUTED }}>
                        {c.contractNo}{c.unit ? ` · Unit ${c.unit}` : ''}{has ? ` · ${c.phone}` : ' · no phone number on file'}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
            {withoutPhone.length > 0 && (
              <p className="text-xs mt-1.5" style={{ color: MUTED }}>
                {withoutPhone.length} of {contracts.length} have no phone number on file and can&rsquo;t be sent to.
              </p>
            )}
          </div>

          {error && <p className="text-xs" style={{ color: '#B91C1C' }}>{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="cursor-pointer text-sm font-semibold px-4 py-2 rounded-lg" style={{ color: MUTED }}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => send.mutate()}
              disabled={sendDisabled}
              className="cursor-pointer inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: PURPLE, color: '#fff' }}
            >
              <MessageCircle size={15} />
              {send.isPending ? 'Sending…' : `Send to ${selected.size}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
