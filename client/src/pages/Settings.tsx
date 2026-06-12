import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import type { UnitType } from '../lib/types'
import { Button, Card, CardBody, CardHeader, Input, PageHeader, Spinner, Table, Td, Th } from '../components/ui'

export default function Settings() {
  const qc = useQueryClient()
  const [edits, setEdits] = useState<Record<string, { weeklyRate?: number; monthlyRate?: number }>>({})
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const { data: types, isLoading } = useQuery<UnitType[]>({
    queryKey: ['unit-types'],
    queryFn: () => api.get('/unit-types').then((r) => r.data),
  })
  const { data: storage } = useQuery<{ driveConfigured: boolean }>({
    queryKey: ['storage-status'],
    queryFn: () => api.get('/documents/storage-status').then((r) => r.data),
  })

  const save = useMutation({
    mutationFn: async () => {
      for (const [id, body] of Object.entries(edits)) {
        await api.put(`/unit-types/${id}`, body)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unit-types'] })
      setEdits({})
      setError('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
    onError: (e) => setError(apiError(e)),
  })

  if (isLoading) return <Spinner />

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Rates and integrations" />

      <Card>
        <CardHeader
          title="Unit sizes & rates"
          subtitle="Default rates applied to new contracts (existing contracts keep their agreed rate)"
          action={
            <div className="flex items-center gap-2">
              {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
              <Button size="sm" disabled={Object.keys(edits).length === 0 || save.isPending} onClick={() => save.mutate()}>
                Save changes
              </Button>
            </div>
          }
        />
        <Table>
          <thead><tr><Th>Size</Th><Th>Label</Th><Th>Weekly rate</Th><Th>Monthly rate</Th></tr></thead>
          <tbody>
            {(types || []).map((t) => (
              <tr key={t._id}>
                <Td className="font-medium">{t.sizeSqf} sq ft</Td>
                <Td>{t.label}</Td>
                <Td>
                  <Input
                    type="number" step="0.01" className="w-28"
                    defaultValue={t.weeklyRate}
                    onChange={(e) => setEdits((p) => ({ ...p, [t._id]: { ...p[t._id], weeklyRate: Number(e.target.value) } }))}
                  />
                </Td>
                <Td>
                  <Input
                    type="number" step="0.01" className="w-28"
                    defaultValue={t.monthlyRate}
                    onChange={(e) => setEdits((p) => ({ ...p, [t._id]: { ...p[t._id], monthlyRate: Number(e.target.value) } }))}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {error && <CardBody><p className="text-xs text-destructive">{error}</p></CardBody>}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Integrations" />
        <CardBody className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="font-medium">Zoho Sign</div>
              <div className="text-xs text-muted-foreground">E-signature for rental contracts</div>
            </div>
            <span className="text-xs text-muted-foreground">Configured via <code>server/.env</code> (ZOHO_*)</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="font-medium">Google Drive</div>
              <div className="text-xs text-muted-foreground">Document storage</div>
            </div>
            <span className={storage?.driveConfigured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
              {storage?.driveConfigured ? 'Connected' : 'Not configured — using local storage'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Setup instructions for both integrations are in <code>README.md</code>.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
