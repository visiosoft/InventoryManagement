import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { apiError, integrationApi, productApi } from '../lib/api'
import type { IntegrationStatus, Product } from '../lib/types'
import { Button, Card, CardBody, CardHeader, Field, Input, Modal, PageHeader, Table, Td, Th } from '../components/ui'
import { formatMoney } from '../lib/utils'


// ---- Products / Services Card ----
function ProductsCard() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [err, setErr] = useState('')

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-all'],
    queryFn: () => productApi.listAll(),
  })

  const create = useMutation({
    mutationFn: (body: Partial<Product>) => productApi.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['products-all'] }); setAdding(false); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Product> }) => productApi.update(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['products-all'] }); setEditing(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => productApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['products-all'] }) },
  })

  function ProductForm({ initial, onSubmit, busy }: { initial?: Product; busy: boolean; onSubmit: (b: Partial<Product>) => void }) {
    const [name, setName] = useState(initial?.name ?? '')
    const [description, setDescription] = useState(initial?.description ?? '')
    const [rate, setRate] = useState(String(initial?.rate ?? ''))
    const [unit, setUnit] = useState(initial?.unit ?? 'qty')
    const [isActive, setIsActive] = useState(initial?.isActive ?? true)

    function submit(e: FormEvent) {
      e.preventDefault()
      onSubmit({ name: name.trim(), description: description.trim(), rate: Number(rate), unit: unit.trim() || 'qty', isActive })
    }

    return (
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Product / Service name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Storage Rental" />
          </Field>
          <Field label="Unit">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="qty / hr / month" />
          </Field>
        </div>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional short description" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate (AED)">
            <Input type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required placeholder="0.00" />
          </Field>
          <Field label="Status">
            <div className="flex items-center gap-2 h-9">
              <button type="button" onClick={() => setIsActive(v => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${isActive ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm">{isActive ? 'Active' : 'Inactive'}</span>
            </div>
          </Field>
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => { setAdding(false); setEditing(null); setErr('') }}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add product'}</Button>
        </div>
      </form>
    )
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Products & Services"
          subtitle={`${products.filter(p => p.isActive).length} active`}
          action={<Button size="sm" onClick={() => { setAdding(true); setEditing(null); setErr('') }}><Plus size={14} /> Add product</Button>}
        />
        {adding && (
          <CardBody className="border-b">
            <ProductForm busy={create.isPending} onSubmit={(b) => create.mutate(b)} />
          </CardBody>
        )}
        {products.length === 0 ? (
          <CardBody><p className="text-sm text-muted-foreground text-center py-4">No products yet. Add your first product or service.</p></CardBody>
        ) : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Description</Th><Th>Rate (AED)</Th><Th>Unit</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p._id} className="hover:bg-muted/50">
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="text-muted-foreground text-xs">{p.description || '—'}</Td>
                  <Td>{formatMoney(p.rate)}</Td>
                  <Td className="text-xs text-muted-foreground">{p.unit}</Td>
                  <Td>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${p.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button type="button" onClick={() => { setEditing(p); setAdding(false); setErr('') }}
                        className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer">
                        <Pencil size={11} /> Edit
                      </button>
                      <button type="button" onClick={() => { if (confirm(`Delete "${p.name}"?`)) remove.mutate(p._id) }}
                        className="text-xs text-destructive hover:underline flex items-center gap-1 cursor-pointer">
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => { setEditing(null); setErr('') }} title="Edit product">
        {editing && (
          <ProductForm initial={editing} busy={update.isPending}
            onSubmit={(b) => update.mutate({ id: editing._id, body: b })} />
        )}
      </Modal>
    </>
  )
}

// ---- Main Settings Page ----
export default function Settings() {
  const qc = useQueryClient()
  const location = useLocation()
  const [driveMsg, setDriveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [gmailMsg, setGmailMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [stripeMsg, setStripeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [stripeSecretKey, setStripeSecretKey] = useState('')
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('')
  const [stripeBusy, setStripeBusy] = useState(false)
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
    if (params.get('gmailConnected')) {
      setGmailMsg({ ok: true, text: 'Gmail connected! You can now send invoices and quotes via email.' })
      window.history.replaceState({}, '', '/settings')
      qc.invalidateQueries({ queryKey: ['integrations-status'] })
    } else if (params.get('gmailError')) {
      setGmailMsg({ ok: false, text: `Gmail connection failed: ${params.get('gmailError')}` })
      window.history.replaceState({}, '', '/settings')
    }
  }, [location.search, qc])

  const { data: integrations } = useQuery<IntegrationStatus>({
    queryKey: ['integrations-status'],
    queryFn: () => integrationApi.status(),
  })

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Settings" subtitle="Products and integrations" />

      <ProductsCard />

      <Card>
        <CardHeader title="Integrations" />
        <CardBody className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg border px-4 py-3 flex-wrap gap-3">
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
                <div className="font-medium">Google Drive (Customer Photos)</div>
                <div className="text-xs text-muted-foreground">
                  Customer-uploaded photos are stored in Google Drive and displayed from Drive URLs
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={integrations?.drive?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
                  {integrations?.drive?.configured ? 'Active — using Google Drive' : 'Not connected'}
                </span>
                <Button
                  size="sm"
                  variant={integrations?.drive?.configured ? 'outline' : 'default'}
                  onClick={async () => {
                    try {
                      const { url } = await integrationApi.connectDrive()
                      window.location.href = url
                    } catch (e) {
                      setDriveMsg({ ok: false, text: apiError(e) })
                    }
                  }}
                >
                  {integrations?.drive?.configured ? 'Reconnect Drive' : 'Connect Google Drive'}
                </Button>
              </div>
            </div>
            {integrations?.drive?.configured && integrations.drive.folderId && (
              <div className="text-xs text-muted-foreground border-t pt-2">
                Folder ID: <code className="bg-muted px-1 rounded">{integrations.drive.folderId}</code>
                {integrations.drive.method && <span className="ml-2">· Auth: {integrations.drive.method === 'service_account' ? 'Service Account' : 'OAuth'}</span>}
              </div>
            )}
            {driveMsg && (
              <p className={`text-xs ${driveMsg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>
                {driveMsg.text}
              </p>
            )}
            {!integrations?.drive?.configured && (
              <p className="text-xs text-muted-foreground">
                Before connecting, add <code className="bg-muted px-1 rounded">http://localhost:5010/api/integrations/drive/callback</code> to your OAuth client's authorized redirect URIs in Google Cloud Console.
              </p>
            )}
          </div>
          <div className="rounded-lg border px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">Gmail (Send Emails)</div>
                <div className="text-xs text-muted-foreground">
                  Send invoice and quote emails with PDF attachments via Gmail API
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={integrations?.gmail?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
                  {integrations?.gmail?.configured ? 'Connected' : 'Not connected'}
                </span>
                <Button
                  size="sm"
                  variant={integrations?.gmail?.configured ? 'outline' : 'default'}
                  onClick={async () => {
                    try {
                      const { url } = await integrationApi.connectGmail()
                      window.location.href = url
                    } catch (e) {
                      setGmailMsg({ ok: false, text: apiError(e) })
                    }
                  }}
                >
                  {integrations?.gmail?.configured ? 'Reconnect Gmail' : 'Connect Gmail'}
                </Button>
              </div>
            </div>
            {gmailMsg && (
              <p className={`text-xs ${gmailMsg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>
                {gmailMsg.text}
              </p>
            )}
            {!integrations?.gmail?.configured && (
              <p className="text-xs text-muted-foreground">
                Add <code className="bg-muted px-1 rounded">{window.location.origin.replace(/:\d+$/, ':5010')}/api/integrations/gmail/callback</code> to your OAuth client's authorized redirect URIs in Google Cloud Console.
              </p>
            )}
          </div>
          <div className="rounded-lg border px-4 py-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">Stripe (Payment Links)</div>
                <div className="text-xs text-muted-foreground">
                  Lets "Send Payment Link" create a real card-payment link — invoices mark themselves paid automatically once it's paid
                </div>
              </div>
              <span className={integrations?.stripe?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
                {integrations?.stripe?.configured
                  ? (integrations.stripe.webhookConfigured ? 'Connected' : 'Connected — webhook secret missing')
                  : 'Not connected'}
              </span>
            </div>

            {!integrations?.stripe?.configured ? (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Secret key">
                    <Input type="password" placeholder="sk_live_… or sk_test_…" value={stripeSecretKey}
                      onChange={(e) => setStripeSecretKey(e.target.value)} />
                  </Field>
                  <Field label="Webhook signing secret (optional now, required to auto-mark paid)">
                    <Input type="password" placeholder="whsec_…" value={stripeWebhookSecret}
                      onChange={(e) => setStripeWebhookSecret(e.target.value)} />
                  </Field>
                </div>
                <Button
                  size="sm"
                  disabled={stripeBusy || !stripeSecretKey}
                  onClick={async () => {
                    setStripeBusy(true)
                    setStripeMsg(null)
                    try {
                      await integrationApi.connectStripe({ secretKey: stripeSecretKey, webhookSecret: stripeWebhookSecret || undefined })
                      setStripeMsg({ ok: true, text: 'Stripe connected.' })
                      setStripeSecretKey('')
                      setStripeWebhookSecret('')
                      qc.invalidateQueries({ queryKey: ['integrations-status'] })
                    } catch (e) {
                      setStripeMsg({ ok: false, text: apiError(e) })
                    } finally {
                      setStripeBusy(false)
                    }
                  }}
                >
                  {stripeBusy ? 'Connecting…' : 'Connect Stripe'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  From your Stripe Dashboard → Developers → API keys, copy the <strong>Secret key</strong>. For the webhook
                  secret: Developers → Webhooks → Add endpoint → URL{' '}
                  <code className="bg-muted px-1 rounded">https://api.purplebox.ae/api/stripe/webhook</code> → events{' '}
                  <code className="bg-muted px-1 rounded">checkout.session.completed</code> → copy the "Signing secret" shown after creating it.
                </p>
              </>
            ) : (
              <div className="flex items-center gap-3">
                {!integrations.stripe.webhookConfigured && (
                  <Field label="Webhook signing secret" className="flex-1 max-w-sm">
                    <Input type="password" placeholder="whsec_…" value={stripeWebhookSecret}
                      onChange={(e) => setStripeWebhookSecret(e.target.value)} />
                  </Field>
                )}
                {!integrations.stripe.webhookConfigured && (
                  <Button
                    size="sm"
                    disabled={stripeBusy || !stripeWebhookSecret}
                    onClick={async () => {
                      setStripeBusy(true)
                      setStripeMsg(null)
                      try {
                        await integrationApi.connectStripe({ webhookSecret: stripeWebhookSecret })
                        setStripeMsg({ ok: true, text: 'Webhook secret saved.' })
                        setStripeWebhookSecret('')
                        qc.invalidateQueries({ queryKey: ['integrations-status'] })
                      } catch (e) {
                        setStripeMsg({ ok: false, text: apiError(e) })
                      } finally {
                        setStripeBusy(false)
                      }
                    }}
                  >
                    {stripeBusy ? 'Saving…' : 'Save webhook secret'}
                  </Button>
                )}
                <Button
                  size="sm" variant="outline"
                  onClick={async () => {
                    if (!confirm('Disconnect Stripe? Existing payment links will stop being trackable.')) return
                    try {
                      await integrationApi.disconnectStripe()
                      qc.invalidateQueries({ queryKey: ['integrations-status'] })
                    } catch (e) {
                      setStripeMsg({ ok: false, text: apiError(e) })
                    }
                  }}
                >
                  Disconnect
                </Button>
              </div>
            )}
            {stripeMsg && (
              <p className={`text-xs ${stripeMsg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>
                {stripeMsg.text}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between rounded-lg border px-4 py-3 flex-wrap gap-3">
            <div>
              <div className="font-medium">WhatsApp (Meta Cloud API)</div>
              <div className="text-xs text-muted-foreground">Webhook verification and setup readiness</div>
            </div>
            <span className={integrations?.whatsapp?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
              {integrations?.whatsapp?.configured ? 'Connected' : `Missing: ${(integrations?.whatsapp?.missing || []).join(', ') || 'keys'}`}
            </span>
          </div>
          <div className="rounded-lg border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">WhatsApp Lead Automation</div>
                <div className="text-xs text-muted-foreground">
                  Connect WhatsApp Web to auto-capture leads by label
                </div>
              </div>
              <Button size="sm" onClick={() => window.open('https://whatsapp.purplebox.ae/whatsapp/setup', '_blank')}>
                Setup
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Setup instructions are in <code>README.md</code>. WhatsApp v1 currently validates webhook setup only.
          </p>
        </CardBody>
      </Card>

    </div>
  )
}
