import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Building2, Check, KeyRound, Loader2, Plus, Trash2, X } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Card, PageHeader, Spinner, Modal, Field, Input, Select } from '../components/ui'

/**
 * The customers, and what can be done to them.
 *
 * Every other page in this system belongs to one company. This one is about
 * the companies, which makes it the page where clicking the wrong row means
 * acting on somebody else's whole business — so the destructive things are
 * deliberately awkward: closing an account keeps the data, and deleting the
 * data needs the account closed first and the name typed back.
 *
 * The server decides who may open this, from a list of addresses in its own
 * environment. A customer's own admin is an admin too, and must never reach
 * it; role alone was never going to be the test.
 */

const MUTED = 'rgba(20,8,31,.55)'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.10)'

type Counts = { users: number; units: number; contracts: number; leads: number }
type Org = {
  _id: string
  name: string
  slug: string
  dbName: string
  status: 'provisioning' | 'trial' | 'active' | 'suspended' | 'cancelled'
  plan: string
  ownerEmail: string
  demo?: boolean
  jobsEnabled?: boolean
  whatsappRouteKey?: string
  createdAt: string
  counts: Counts | null
  error?: string
}

/** The same rule the server applies, so the preview cannot promise an address
 *  the server would not give. */
function slugify(name: string) {
  return String(name || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

const STATUS_TONE: Record<Org['status'], { bg: string; fg: string }> = {
  provisioning: { bg: '#EDE5FF', fg: '#4A1FA0' },
  trial: { bg: '#DBEAFE', fg: '#1D4ED8' },
  active: { bg: '#DCFCE7', fg: '#047857' },
  suspended: { bg: '#FEF3C7', fg: '#92400E' },
  cancelled: { bg: '#F1F5F9', fg: '#475569' },
}

/** Shown once and never again, so it is worth making hard to miss. */
function Handover({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Their sign-in details">
      <div className="space-y-3">
        <p style={{ fontSize: 13, color: MUTED }}>
          This password is shown once and is not stored anywhere. Copy it now — if it is lost,
          the only way back is to reset it from this page.
        </p>
        <div style={{ background: '#FBF8F2', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 12, color: MUTED }}>Email</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{email}</div>
          <div style={{ fontSize: 12, color: MUTED }}>Password</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{password}</div>
        </div>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(`${email}\n${password}`)}
          className="cursor-pointer"
          style={{ fontSize: 12.5, fontWeight: 600, color: PURPLE, background: 'none', border: 'none' }}
        >
          Copy both
        </button>
      </div>
    </Modal>
  )
}

export default function Platform() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', ownerEmail: '', adminName: '' })
  const [handover, setHandover] = useState<{ email: string; password: string } | null>(null)
  const [deleting, setDeleting] = useState<Org | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [err, setErr] = useState('')

  const { data, isLoading } = useQuery<{ organisations: Org[]; owners: string[] }>({
    queryKey: ['platform-orgs'],
    queryFn: () => api.get('/platform/organisations').then((r) => r.data),
    retry: false,
  })

  const done = () => { qc.invalidateQueries({ queryKey: ['platform-orgs'] }); setErr('') }

  const create = useMutation({
    mutationFn: () => api.post('/platform/organisations', form).then((r) => r.data),
    onSuccess: (out) => {
      setAdding(false)
      setForm({ name: '', slug: '', ownerEmail: '', adminName: '' })
      if (out?.admin?.password) setHandover({ email: out.admin.email, password: out.admin.password })
      done()
    },
    onError: (e) => setErr(apiError(e)),
  })

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/platform/organisations/${id}`, body),
    onSuccess: done,
    onError: (e) => setErr(apiError(e)),
  })

  const resetAdmin = useMutation({
    mutationFn: (id: string) => api.post(`/platform/organisations/${id}/reset-admin`).then((r) => r.data),
    onSuccess: (out) => setHandover({ email: out.email, password: out.password }),
    onError: (e) => setErr(apiError(e)),
  })

  const close = useMutation({
    mutationFn: (id: string) => api.delete(`/platform/organisations/${id}`),
    onSuccess: done,
    onError: (e) => setErr(apiError(e)),
  })

  const destroy = useMutation({
    mutationFn: ({ id, slug }: { id: string; slug: string }) =>
      api.delete(`/platform/organisations/${id}/data`, { params: { confirm: slug } }),
    onSuccess: () => { setDeleting(null); setConfirmText(''); done() },
    onError: (e) => setErr(apiError(e)),
  })

  if (isLoading) return <Spinner />

  const orgs = data?.organisations ?? []

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${orgs.length} ${orgs.length === 1 ? 'company' : 'companies'} on the platform`}
        action={
          <button
            type="button"
            onClick={() => { setAdding(true); setErr('') }}
            className="inline-flex items-center gap-2 cursor-pointer"
            style={{ height: 38, padding: '0 16px', borderRadius: 999, background: PURPLE, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700 }}
          >
            <Plus size={15} /> New customer
          </button>
        }
      />

      {err && (
        <div className="mb-4 rounded-xl px-3.5 py-3 flex items-start gap-2"
          style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13 }}>
          <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
          <span className="flex-1">{err}</span>
          <button type="button" onClick={() => setErr('')} style={{ background: 'none', border: 'none', color: '#991B1B' }}><X size={14} /></button>
        </div>
      )}

      <div className="space-y-3">
        {orgs.length === 0 && (
          <Card><div style={{ padding: 20, fontSize: 13, color: MUTED }}>No customers yet.</div></Card>
        )}

        {orgs.map((org) => {
          const tone = STATUS_TONE[org.status]
          return (
            <Card key={org._id}>
              <div className="flex flex-wrap items-center gap-3" style={{ padding: '14px 16px' }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: '#F7F3FF', color: PURPLE, display: 'grid', placeItems: 'center' }}>
                  <Building2 size={17} />
                </span>

                <div className="min-w-0" style={{ flex: '1 1 220px' }}>
                  <div className="flex items-center gap-2">
                    <span className="truncate" style={{ fontSize: 15, fontWeight: 700 }}>{org.name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: '2px 8px', background: tone.bg, color: tone.fg }}>
                      {org.status}
                    </span>
                    {org.demo && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: '2px 8px', background: '#F1F5F9', color: '#475569' }}>demo</span>
                    )}
                  </div>
                  <div className="truncate" style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                    {org.slug}.purplebox.ae · {org.ownerEmail}
                  </div>
                </div>

                {/* Size, not business. How much is in there, never what it says. */}
                <div style={{ flex: '0 0 auto', fontSize: 12, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                  {org.counts
                    ? `${org.counts.users} users · ${org.counts.units} units · ${org.counts.contracts} contracts · ${org.counts.leads} leads`
                    : <span style={{ color: '#B91C1C' }}>database unreachable</span>}
                </div>

                <div className="flex items-center gap-1.5" style={{ marginLeft: 'auto' }}>
                  <Select
                    value={org.status}
                    onChange={(e) => patch.mutate({ id: org._id, body: { status: e.target.value } })}
                    style={{ height: 30, fontSize: 12 }}
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>

                  <button
                    type="button"
                    title="Give their first admin a new password"
                    onClick={() => resetAdmin.mutate(org._id)}
                    disabled={resetAdmin.isPending}
                    className="cursor-pointer inline-flex items-center justify-center"
                    style={{ width: 30, height: 30, borderRadius: 9, background: '#F4F2F7', color: '#4A4357', border: 'none' }}
                  >
                    {resetAdmin.isPending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  </button>

                  {org.status === 'cancelled' ? (
                    <button
                      type="button"
                      title="Delete their data permanently"
                      onClick={() => { setDeleting(org); setConfirmText(''); setErr('') }}
                      className="cursor-pointer inline-flex items-center justify-center"
                      style={{ width: 30, height: 30, borderRadius: 9, background: '#FEE2E2', color: '#B91C1C', border: 'none' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      title="Close the account — their data is kept"
                      onClick={() => close.mutate(org._id)}
                      className="cursor-pointer"
                      style={{ height: 30, padding: '0 10px', borderRadius: 9, background: '#F4F2F7', color: '#4A4357', border: 'none', fontSize: 12, fontWeight: 600 }}
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>

              {org.whatsappRouteKey && (
                <div style={{ padding: '0 16px 14px', fontSize: 11.5, color: MUTED }}>
                  Their WhatsApp webhook:{' '}
                  <code style={{ fontFamily: 'ui-monospace, monospace' }}>
                    /api/wa/{org.whatsappRouteKey}/webhook
                  </code>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* ── New customer ─────────────────────────────────────────────────── */}
      <Modal open={adding} onClose={() => setAdding(false)} title="New customer">
        <div className="space-y-3">
          <Field label="Company name">
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Acme Storage"
            />
          </Field>
          {/* Called "Address" once, and somebody reasonably typed a street
              address into it — which became a forty-character subdomain. It is
              a web address, and the field now shows the URL it produces so
              there is nothing to guess at. */}
          <Field label="Web address">
            <Input
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="acme"
            />
            <div style={{ fontSize: 12, color: MUTED, marginTop: 5 }}>
              {(() => {
                const preview = slugify(form.slug || form.name)
                return preview
                  ? <>Their system will be at <strong>{preview}.purplebox.ae</strong></>
                  : 'Leave blank to take it from the company name.'
              })()}
            </div>
          </Field>
          <Field label="Their first admin's email">
            <Input
              type="email"
              value={form.ownerEmail}
              onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))}
              placeholder="owner@acme.ae"
            />
          </Field>
          <Field label="Their name">
            <Input
              value={form.adminName}
              onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
              placeholder="Optional"
            />
          </Field>

          <p style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
            They get their own database, a price list to edit and one admin account. The assistant,
            lead distribution, automation and backups all start switched off — they turn on what
            they want. Setting up takes a few seconds.
          </p>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={!form.name.trim() || !form.ownerEmail.trim() || create.isPending}
              onClick={() => { setErr(''); create.mutate() }}
              className="inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
              style={{ height: 38, padding: '0 16px', borderRadius: 999, background: PURPLE, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700 }}
            >
              {create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {create.isPending ? 'Setting them up…' : 'Create'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="cursor-pointer"
              style={{ fontSize: 13, color: MUTED, background: 'none', border: 'none' }}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Deleting a company's data ────────────────────────────────────── */}
      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="Delete this customer's data">
        {deleting && (
          <div className="space-y-3">
            <div className="rounded-xl px-3.5 py-3" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13, lineHeight: 1.5 }}>
              This deletes <strong>{deleting.name}</strong> entirely — every contract, every
              conversation, every document. It cannot be undone, and there is no copy of it
              anywhere else.
            </div>
            <Field label={`Type "${deleting.slug}" to confirm`}>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={deleting.slug} />
            </Field>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={confirmText !== deleting.slug || destroy.isPending}
                onClick={() => destroy.mutate({ id: deleting._id, slug: deleting.slug })}
                className="inline-flex items-center gap-2 cursor-pointer disabled:opacity-40"
                style={{ height: 38, padding: '0 16px', borderRadius: 999, background: '#B91C1C', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700 }}
              >
                {destroy.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Delete permanently
              </button>
              <button type="button" onClick={() => setDeleting(null)} className="cursor-pointer"
                style={{ fontSize: 13, color: MUTED, background: 'none', border: 'none' }}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </Modal>

      {handover && (
        <Handover email={handover.email} password={handover.password} onClose={() => setHandover(null)} />
      )}
    </div>
  )
}
