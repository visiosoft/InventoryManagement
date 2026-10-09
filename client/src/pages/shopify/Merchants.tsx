import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Settings2, ShoppingBag } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'
import type { ConnectInfo, Merchant, ShopifyLocation } from '../../lib/shopify'

type SiteRef = { _id: string; name: string; code: string }
type AuthMode = Merchant['authMode']

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Never')

/** Client ID + secret (Dev Dashboard app, the only kind Shopify allows creating
 *  since January 2026) or a legacy shpat_ token from an older custom app. */
function CredentialFields({ mode, setMode, values, set }: {
  mode: AuthMode
  setMode: (m: AuthMode) => void
  values: { accessToken: string; clientId: string; clientSecret: string }
  set: (k: 'accessToken' | 'clientId' | 'clientSecret', v: string) => void
}) {
  return (
    <>
      <Field label="How does this store connect?">
        <Select value={mode} onChange={e => setMode(e.target.value as AuthMode)}>
          <option value="client_credentials">Dev Dashboard app (client ID + secret)</option>
          <option value="static_token">Legacy custom app (shpat_ access token)</option>
        </Select>
      </Field>
      {mode === 'client_credentials' ? (
        <>
          <Field label="Client ID">
            <Input value={values.clientId} onChange={e => set('clientId', e.target.value)} />
          </Field>
          <Field label="Client secret">
            <Input type="password" value={values.clientSecret} onChange={e => set('clientSecret', e.target.value)} />
          </Field>
        </>
      ) : (
        <Field label="Admin API access token">
          <Input type="password" value={values.accessToken} onChange={e => set('accessToken', e.target.value)} placeholder="shpat_..." />
        </Field>
      )}
    </>
  )
}

function MerchantModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [shopDomain, setShopDomain] = useState('')
  const [mode, setMode] = useState<AuthMode>('client_credentials')
  const [creds, setCreds] = useState({ accessToken: '', clientId: '', clientSecret: '' })
  const [webhookSecret, setWebhookSecret] = useState('')
  const [site, setSite] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: sites } = useQuery<SiteRef[]>({
    queryKey: ['warehouse-sites'],
    queryFn: () => api.get('/warehouse/setup').then(r => r.data.sites),
  })
  const { data: info } = useQuery<ConnectInfo>({
    queryKey: ['shopify-connect-info'],
    queryFn: () => api.get('/shopify/connect-info').then(r => r.data),
  })

  const credsReady = mode === 'client_credentials' ? creds.clientId && creds.clientSecret : creds.accessToken

  async function submit() {
    setBusy(true); setErr('')
    try {
      await api.post('/shopify/merchants', { name, shopDomain, authMode: mode, ...creds, webhookSecret, site, warehouse })
      onDone()
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal open title="Connect a Shopify store" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Merchant name">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Duriya" />
        </Field>
        <Field label="Shop domain">
          <Input value={shopDomain} onChange={e => setShopDomain(e.target.value)} placeholder="duriya.myshopify.com" />
        </Field>
        <CredentialFields mode={mode} setMode={setMode} values={creds} set={(k, v) => setCreds(c => ({ ...c, [k]: v }))} />
        {mode === 'static_token' && (
          <Field label="Webhook signing secret (the app's API secret key)">
            <Input type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} />
          </Field>
        )}
        <Field label="Facility">
          <Select value={site} onChange={e => setSite(e.target.value)}>
            <option value="">Select a facility…</option>
            {(sites ?? []).map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Warehouse code">
          <Input value={warehouse} onChange={e => setWarehouse(e.target.value.toUpperCase())} placeholder="WH1" />
        </Field>
        {info && (
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">The app in Shopify needs these scopes:</p>
            <p className="font-mono break-words">{info.scopes.join(', ')}</p>
          </div>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name || !shopDomain || !credsReady || !site || !warehouse}>
            {busy ? 'Checking with Shopify…' : 'Connect'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Everything after the first connect: which Shopify location is us, order
 *  webhooks, stock sync, and replacing credentials. */
function MerchantSetup({ merchant, onClose, onChanged }: { merchant: Merchant; onClose: () => void; onChanged: () => void }) {
  const [location, setLocation] = useState(merchant.shopifyLocationId)
  const [mode, setMode] = useState<AuthMode>(merchant.authMode)
  const [creds, setCreds] = useState({ accessToken: '', clientId: merchant.clientId, clientSecret: '' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  const { data: locations, isLoading: loadingLocations, error: locationsError } = useQuery<ShopifyLocation[]>({
    queryKey: ['shopify-locations', merchant._id],
    queryFn: () => api.get(`/shopify/merchants/${merchant._id}/locations`).then(r => r.data),
    retry: false,
  })

  async function act(label: string, fn: () => Promise<string>) {
    setBusy(label); setErr(''); setMsg('')
    try { setMsg(await fn()); onChanged() }
    catch (e) { setErr(apiError(e)) }
    finally { setBusy('') }
  }
  const patch = (body: object) => api.patch(`/shopify/merchants/${merchant._id}`, body)

  return (
    <Modal open title={`Set up ${merchant.name}`} onClose={onClose} wide>
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">1. This warehouse's Shopify location</h3>
          <p className="text-xs text-muted-foreground">Fulfillments are sent from this location and stock is written to it.</p>
          {loadingLocations ? <Spinner /> : locationsError ? (
            <p className="text-xs text-destructive">{apiError(locationsError)}</p>
          ) : (
            <div className="flex flex-wrap gap-2 items-end">
              <Select value={location} onChange={e => setLocation(e.target.value)} className="max-w-sm">
                <option value="">Not set</option>
                {(locations ?? []).map(l => <option key={l.id} value={l.id}>{l.name}{l.place ? ` — ${l.place}` : ''}</option>)}
              </Select>
              <Button variant="outline" disabled={!!busy || location === merchant.shopifyLocationId}
                onClick={() => act('location', async () => { await patch({ shopifyLocationId: location }); return 'Location saved.' })}>
                Save location
              </Button>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">2. Order webhooks</h3>
          <p className="text-xs text-muted-foreground">
            New, changed and cancelled orders arrive here automatically once these are registered.
            {merchant.webhooksRegisteredAt ? ` Registered ${when(merchant.webhooksRegisteredAt)}.` : ''}
            {' '}Last order received: {when(merchant.lastOrderWebhookAt)}.
          </p>
          <Button variant="outline" disabled={!!busy}
            onClick={() => act('webhooks', async () => {
              const { data } = await api.post(`/shopify/merchants/${merchant._id}/webhooks`)
              return data.created.length
                ? `Registered ${data.created.length} webhook(s) to ${data.webhookUrl}.`
                : `Already registered to ${data.webhookUrl}.`
            })}>
            {busy === 'webhooks' ? 'Registering…' : 'Register order webhooks'}
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">3. Stock sync to Shopify</h3>
          <p className="text-xs text-muted-foreground">
            When on, free stock here (on hand minus reserved) becomes the "available" quantity at that location in Shopify,
            overwriting what's there. Only SKUs this warehouse has recorded stock for are touched.
            Last push: {when(merchant.lastInventoryPushAt)}.
          </p>
          {merchant.lastInventoryPushError && <p className="text-xs text-destructive">Last push failed: {merchant.lastInventoryPushError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant={merchant.inventorySyncEnabled ? 'outline' : 'default'} disabled={!!busy || !merchant.shopifyLocationId}
              onClick={() => act('sync', async () => {
                await patch({ inventorySyncEnabled: !merchant.inventorySyncEnabled })
                return merchant.inventorySyncEnabled ? 'Stock sync turned off.' : 'Stock sync turned on.'
              })}>
              {merchant.inventorySyncEnabled ? 'Turn stock sync off' : 'Turn stock sync on'}
            </Button>
            <Button variant="outline" disabled={!!busy || !merchant.shopifyLocationId}
              onClick={() => act('push', async () => {
                const { data } = await api.post(`/shopify/merchants/${merchant._id}/push-inventory`)
                return `Sent ${data.pushed} SKU(s) to Shopify.${data.skippedWithoutShopifyItem ? ` ${data.skippedWithoutShopifyItem} skipped — sync the catalog first.` : ''}`
              })}>
              {busy === 'push' ? 'Pushing…' : 'Push all stock now'}
            </Button>
          </div>
          {!merchant.shopifyLocationId && <p className="text-xs text-muted-foreground">Choose the location above first.</p>}
        </section>

        <section className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">Replace credentials</h3>
          <CredentialFields mode={mode} setMode={setMode} values={creds} set={(k, v) => setCreds(c => ({ ...c, [k]: v }))} />
          <Button variant="outline"
            disabled={!!busy || (mode === 'client_credentials' ? !creds.clientId || !creds.clientSecret : !creds.accessToken)}
            onClick={() => act('creds', async () => {
              await patch({ authMode: mode, ...creds })
              setCreds(c => ({ ...c, accessToken: '', clientSecret: '' }))
              return 'Credentials checked with Shopify and saved.'
            })}>
            {busy === 'creds' ? 'Checking…' : 'Save new credentials'}
          </Button>
        </section>

        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

export default function Merchants() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [setupId, setSetupId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState('')

  const { data: merchants, isLoading } = useQuery<Merchant[]>({
    queryKey: ['shopify-merchants'],
    queryFn: () => api.get('/shopify/merchants').then(r => r.data),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['shopify-merchants'] })

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/shopify/merchants/${id}`, { isActive }),
    onSuccess: invalidate,
  })

  async function syncNow(id: string) {
    setSyncingId(id); setSyncResult('')
    try {
      const { data } = await api.post(`/shopify/merchants/${id}/sync`)
      setSyncResult(`Synced ${data.total} variants (${data.created} new, ${data.updated} updated).`)
      invalidate()
    } catch (e) {
      setSyncResult(apiError(e))
    } finally {
      setSyncingId(null)
    }
  }

  const setupMerchant = merchants?.find(m => m._id === setupId) ?? null

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Shopify merchants"
        subtitle="Stores this warehouse fulfills orders for."
        action={<Button onClick={() => setAdding(true)}>Connect a store</Button>}
      />
      {syncResult && <p className="text-sm text-muted-foreground">{syncResult}</p>}
      <Card>
        <CardHeader title="Connected stores" />
        <CardBody>
          {isLoading ? <Spinner /> : !merchants?.length ? (
            <EmptyState message="No Shopify stores connected yet." />
          ) : (
            <Table>
              <thead><tr><Th>Store</Th><Th>Warehouse</Th><Th>Status</Th><Th>Orders</Th><Th>Stock sync</Th><Th>Catalog synced</Th><Th /></tr></thead>
              <tbody>
                {merchants.map(m => (
                  <tr key={m._id}>
                    <Td>
                      <div className="font-medium flex items-center gap-2"><ShoppingBag size={14} /> {m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.shopDomain}</div>
                    </Td>
                    <Td className="text-sm text-muted-foreground">
                      {m.warehouse}
                      {m.shopifyLocationName && <div className="text-xs">→ {m.shopifyLocationName}</div>}
                    </Td>
                    <Td><Badge tone={m.isActive ? 'green' : 'gray'}>{m.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                    <Td>
                      {m.webhooksRegisteredAt
                        ? <Badge tone="green">Live</Badge>
                        : <Badge tone="amber">Webhooks not set up</Badge>}
                      {m.lastOrderWebhookAt && <div className="text-xs text-muted-foreground mt-1">Last: {when(m.lastOrderWebhookAt)}</div>}
                    </Td>
                    <Td>
                      {m.lastInventoryPushError
                        ? <Badge tone="red">Failing</Badge>
                        : <Badge tone={m.inventorySyncEnabled ? 'green' : 'gray'}>{m.inventorySyncEnabled ? 'On' : 'Off'}</Badge>}
                    </Td>
                    <Td className="text-sm text-muted-foreground">{when(m.lastInventorySyncAt)}</Td>
                    <Td>
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => setSetupId(m._id)}>
                          <Settings2 size={13} /> Set up
                        </Button>
                        <Button variant="outline" disabled={syncingId === m._id} onClick={() => syncNow(m._id)}>
                          <RefreshCw size={13} className={syncingId === m._id ? 'animate-spin' : ''} /> Sync catalog
                        </Button>
                        <Button variant="outline" onClick={() => toggleActive.mutate({ id: m._id, isActive: !m.isActive })}>
                          {m.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
      {adding && <MerchantModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); invalidate() }} />}
      {setupMerchant && <MerchantSetup merchant={setupMerchant} onClose={() => setSetupId(null)} onChanged={invalidate} />}
    </div>
  )
}
