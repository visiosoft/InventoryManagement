import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { apiError, integrationApi, unitTypeApi, api } from '../lib/api'
import type { IntegrationStatus, UnitType } from '../lib/types'
import { Button, Card, CardBody, CardHeader, Field, Input, Modal, PageHeader, Table, Td, Th } from '../components/ui'
import { formatMoney } from '../lib/utils'
import { useAuth } from '../lib/auth'

// ---- Tier Form ----
function TierForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<UnitType>
  busy: boolean
  onSubmit: (body: Partial<UnitType>) => void
  onCancel: () => void
}) {
  const [sizeSqf, setSizeSqf] = useState(String(initial?.sizeSqf ?? ''))
  const [label, setLabel] = useState(initial?.label ?? '')
  const [monthlyRate, setMonthlyRate] = useState(String(initial?.monthlyRate ?? ''))
  const [weeklyRate, setWeeklyRate] = useState(String(initial?.weeklyRate ?? ''))
  const [discountPct, setDiscountPct] = useState(String(initial?.discountPct ?? '20'))

  function autoWeekly() {
    const m = Number(monthlyRate)
    if (m > 0 && !weeklyRate) setWeeklyRate(String(Math.round((m / 4) * 100) / 100))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({
      sizeSqf: Number(sizeSqf),
      label: label.trim() || `${sizeSqf} Sq Ft`,
      monthlyRate: Number(monthlyRate),
      weeklyRate: Number(weeklyRate) || Math.round((Number(monthlyRate) / 4) * 100) / 100,
      discountPct: Number(discountPct),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Size (Sq Ft) *">
          <Input type="number" min={1} value={sizeSqf} onChange={(e) => setSizeSqf(e.target.value)} required />
        </Field>
        <Field label="Label (optional)">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${sizeSqf || '?'} Sq Ft`} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Monthly Rate (AED) *">
          <Input
            type="number" min={0} step="0.01" value={monthlyRate}
            onChange={(e) => setMonthlyRate(e.target.value)}
            onBlur={autoWeekly}
            required
          />
        </Field>
        <Field label="Weekly Rate (AED)">
          <Input
            type="number" min={0} step="0.01" value={weeklyRate}
            onChange={(e) => setWeeklyRate(e.target.value)}
            placeholder={monthlyRate ? String(Math.round((Number(monthlyRate) / 4) * 100) / 100) : 'Auto (monthly ÷ 4)'}
          />
        </Field>
      </div>
      <Field label="First-Month Discount %">
        <Input
          type="number" min={0} max={100} step="1" value={discountPct}
          onChange={(e) => setDiscountPct(e.target.value)}
        />
      </Field>
      {Number(discountPct) > 0 && Number(monthlyRate) > 0 && (
        <p className="text-xs text-muted-foreground">
          First month: <strong>{formatMoney(Math.round(Number(monthlyRate) * (1 - Number(discountPct) / 100) * 100) / 100)}</strong> ({discountPct}% off {formatMoney(Number(monthlyRate))})
        </p>
      )}
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial?._id ? 'Save changes' : 'Add tier'}</Button>
      </div>
    </form>
  )
}

// ---- Pricing Tiers Card ----
function PricingTiersCard() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<UnitType | null>(null)
  const [err, setErr] = useState('')

  const { data: tiers, isLoading } = useQuery<UnitType[]>({
    queryKey: ['unit-types'],
    queryFn: () => unitTypeApi.list(),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['unit-types'] })

  const createTier = useMutation({
    mutationFn: (body: Partial<UnitType>) => unitTypeApi.create(body),
    onSuccess: () => { invalidate(); setAdding(false); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const updateTier = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<UnitType> }) => unitTypeApi.update(id, body),
    onSuccess: () => { invalidate(); setEditing(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const deleteTier = useMutation({
    mutationFn: (id: string) => unitTypeApi.remove(id),
    onSuccess: () => invalidate(),
    onError: (e) => alert(apiError(e)),
  })

  return (
    <>
      <Card>
        <CardHeader
          title="Unit pricing tiers"
          subtitle="Monthly and weekly rates by storage size. Auto-filled when creating contracts."
          action={
            <Button size="sm" onClick={() => { setAdding(true); setErr('') }}>
              <Plus size={14} /> Add tier
            </Button>
          }
        />
        {isLoading ? (
          <CardBody className="text-sm text-muted-foreground">Loading…</CardBody>
        ) : (tiers ?? []).length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">No pricing tiers yet. Add one above.</CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Size</Th>
                <Th>Monthly Rate</Th>
                <Th>Weekly Rate</Th>
                <Th>1st Month Discount</Th>
                <Th>1st Month Price</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(tiers ?? []).map((t) => {
                const discountedMonthly = Math.round(t.monthlyRate * (1 - t.discountPct / 100) * 100) / 100
                return (
                  <tr key={t._id} className="hover:bg-muted/50">
                    <Td className="font-medium">{t.label || `${t.sizeSqf} Sq Ft`}</Td>
                    <Td>{formatMoney(t.monthlyRate)} / mo</Td>
                    <Td>{formatMoney(t.weeklyRate)} / wk</Td>
                    <Td>
                      {t.discountPct > 0 ? (
                        <span className="text-amber-600 font-medium">{t.discountPct}% off</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>{t.discountPct > 0 ? formatMoney(discountedMonthly) : '—'}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={() => { setEditing(t); setErr('') }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="text-muted-foreground hover:text-destructive cursor-pointer"
                          onClick={() => {
                            if (confirm(`Delete tier "${t.label || t.sizeSqf + ' Sq Ft'}"?`)) deleteTier.mutate(t._id)
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add pricing tier">
        {err && <p className="text-xs text-destructive mb-3">{err}</p>}
        <TierForm
          busy={createTier.isPending}
          onSubmit={(body) => createTier.mutate(body)}
          onCancel={() => setAdding(false)}
        />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit pricing tier">
        {err && <p className="text-xs text-destructive mb-3">{err}</p>}
        {editing && (
          <TierForm
            initial={editing}
            busy={updateTier.isPending}
            onSubmit={(body) => updateTier.mutate({ id: editing._id, body })}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  )
}

// ---- Main Settings Page ----
export default function Settings() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const location = useLocation()
  const [driveMsg, setDriveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('driveConnected')) {
      setDriveMsg({ ok: true, text: 'Google Drive connected! A "PurpleBox Documents" folder was created in your Drive.' })
      window.history.replaceState({}, '', '/settings')
      qc.invalidateQueries({ queryKey: ['integrations-status'] })
    } else if (params.get('driveError')) {
      setDriveMsg({ ok: false, text: `Drive connection failed: ${params.get('driveError')}` })
      window.history.replaceState({}, '', '/settings')
    }
  }, [location.search, qc])

  const { data: integrations } = useQuery<IntegrationStatus>({
    queryKey: ['integrations-status'],
    queryFn: () => integrationApi.status(),
  })
  const syncContacts = useMutation({
    mutationFn: () => integrationApi.syncGoogleContacts(user?.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Settings" subtitle="Pricing tiers and integrations" />

      <PricingTiersCard />

      <Card>
        <CardHeader title="Integrations" />
        <CardBody className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="font-medium">Zoho Sign</div>
              <div className="text-xs text-muted-foreground">E-signature for rental contracts</div>
            </div>
            <span className={integrations?.zoho?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
              {integrations?.zoho?.configured ? 'Connected' : 'Not configured'}
            </span>
          </div>
          <div className="rounded-lg border px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">Google Drive</div>
                <div className="text-xs text-muted-foreground">Document storage for customer ID proofs, contracts, and files</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={integrations?.drive?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
                  {integrations?.drive?.configured ? 'Connected' : 'Not connected — using local storage'}
                </span>
                <Button
                  size="sm"
                  variant={integrations?.drive?.configured ? 'outline' : 'default'}
                  onClick={async () => {
                    try {
                      const { url } = await api.get('/integrations/drive/connect').then(r => r.data)
                      window.location.href = url
                    } catch (e) {
                      setDriveMsg({ ok: false, text: apiError(e) })
                    }
                  }}
                >
                  {integrations?.drive?.configured ? 'Reconnect' : 'Connect Drive'}
                </Button>
              </div>
            </div>
            {driveMsg && (
              <p className={`text-xs ${driveMsg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>
                {driveMsg.text}
              </p>
            )}
            {!integrations?.drive?.configured && (
              <p className="text-xs text-muted-foreground">
                Before connecting, add <code className="bg-muted px-1 rounded">http://localhost:5010/api/integrations/drive/callback</code> to your OAuth 2.0 client's authorized redirect URIs in Google Cloud Console.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="font-medium">WhatsApp (Meta Cloud API)</div>
              <div className="text-xs text-muted-foreground">Webhook verification and setup readiness</div>
            </div>
            <span className={integrations?.whatsapp?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
              {integrations?.whatsapp?.configured ? 'Connected' : `Missing: ${(integrations?.whatsapp?.missing || []).join(', ') || 'keys'}`}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="font-medium">Google Contacts</div>
              <div className="text-xs text-muted-foreground">Import contacts into leads (auto create/update by phone)</div>
            </div>
            <span className={integrations?.googleContacts?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
              {integrations?.googleContacts?.configured ? 'Connected' : `Missing: ${(integrations?.googleContacts?.missing || []).join(', ') || 'keys'}`}
            </span>
          </div>
          <div className="rounded-lg border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium text-sm">Google Contacts sync</div>
                <div className="text-xs text-muted-foreground">Manually trigger sync to create/update leads</div>
              </div>
              <Button onClick={() => syncContacts.mutate()} disabled={syncContacts.isPending}>
                {syncContacts.isPending ? 'Syncing…' : 'Sync now'}
              </Button>
            </div>
            {syncContacts.isSuccess && (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                Sync finished. Created {syncContacts.data.summary.created}, updated {syncContacts.data.summary.updated}, skipped {syncContacts.data.summary.skipped}, errors {syncContacts.data.summary.errors}.
              </p>
            )}
            {syncContacts.isError && (
              <p className="mt-2 text-xs text-destructive">{apiError(syncContacts.error)}</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Setup instructions are in <code>README.md</code>. WhatsApp v1 currently validates webhook setup only.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
