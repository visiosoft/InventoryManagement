import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiError, integrationApi } from '../lib/api'
import type { IntegrationStatus } from '../lib/types'
import { Button, Card, CardBody, CardHeader, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Settings() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: integrations } = useQuery<IntegrationStatus>({
    queryKey: ['integrations-status'],
    queryFn: () => integrationApi.status(),
  })
  const syncContacts = useMutation({
    mutationFn: () => integrationApi.syncGoogleContacts(user?.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Pricing and integrations" />

      <Card>
        <CardHeader title="Unit pricing" />
        <CardBody className="text-sm text-muted-foreground">
          Each unit has its own monthly price (AED), imported from the facility inventory sheet.
          Edit a unit's price from the <Link to="/units" className="text-primary hover:underline">Units</Link> page —
          click a unit and update its details. Weekly contracts default to the monthly price ÷ 4
          (the agreement defines a month as four weeks).
        </CardBody>
      </Card>

      <Card className="mt-4">
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
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="font-medium">Google Drive</div>
              <div className="text-xs text-muted-foreground">Document storage</div>
            </div>
            <span className={integrations?.drive?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
              {integrations?.drive?.configured ? 'Connected' : 'Not configured — using local storage'}
            </span>
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
