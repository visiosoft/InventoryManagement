import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ShoppingBag } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'
import type { Merchant } from '../../lib/shopify'

type SiteRef = { _id: string; name: string; code: string }

function MerchantModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [shopDomain, setShopDomain] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [site, setSite] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: sites } = useQuery<SiteRef[]>({
    queryKey: ['warehouse-sites'],
    queryFn: () => api.get('/warehouse/setup').then(r => r.data.sites),
  })

  async function submit() {
    setBusy(true); setErr('')
    try {
      await api.post('/shopify/merchants', { name, shopDomain, accessToken, webhookSecret, site, warehouse })
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
        <Field label="Admin API access token">
          <Input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="shpat_..." />
        </Field>
        <Field label="Webhook signing secret (optional for now)">
          <Input type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder="whsec_..." />
        </Field>
        <Field label="Facility">
          <Select value={site} onChange={e => setSite(e.target.value)}>
            <option value="">Select a facility…</option>
            {(sites ?? []).map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Warehouse code">
          <Input value={warehouse} onChange={e => setWarehouse(e.target.value.toUpperCase())} placeholder="WH1" />
        </Field>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name || !shopDomain || !accessToken || !site || !warehouse}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function Merchants() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState('')

  const { data: merchants, isLoading } = useQuery<Merchant[]>({
    queryKey: ['shopify-merchants'],
    queryFn: () => api.get('/shopify/merchants').then(r => r.data),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/shopify/merchants/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopify-merchants'] }),
  })

  async function syncNow(id: string) {
    setSyncingId(id); setSyncResult('')
    try {
      const { data } = await api.post(`/shopify/merchants/${id}/sync`)
      setSyncResult(`Synced ${data.total} variants (${data.created} new, ${data.updated} updated).`)
      qc.invalidateQueries({ queryKey: ['shopify-merchants'] })
    } catch (e) {
      setSyncResult(apiError(e))
    } finally {
      setSyncingId(null)
    }
  }

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
              <thead><tr><Th>Store</Th><Th>Domain</Th><Th>Facility / warehouse</Th><Th>Status</Th><Th>Last sync</Th><Th /></tr></thead>
              <tbody>
                {merchants.map(m => (
                  <tr key={m._id}>
                    <Td className="font-medium flex items-center gap-2"><ShoppingBag size={14} /> {m.name}</Td>
                    <Td className="text-sm text-muted-foreground">{m.shopDomain}</Td>
                    <Td className="text-sm text-muted-foreground">{m.warehouse}</Td>
                    <Td><Badge tone={m.isActive ? 'green' : 'gray'}>{m.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                    <Td className="text-sm text-muted-foreground">{m.lastInventorySyncAt ? new Date(m.lastInventorySyncAt).toLocaleString() : 'Never'}</Td>
                    <Td>
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" disabled={syncingId === m._id} onClick={() => syncNow(m._id)}>
                          <RefreshCw size={13} className={syncingId === m._id ? 'animate-spin' : ''} /> Sync now
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
      {adding && <MerchantModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['shopify-merchants'] }) }} />}
    </div>
  )
}
