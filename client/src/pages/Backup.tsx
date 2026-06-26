import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudUpload, Database, ExternalLink, HardDrive, RefreshCw } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Spinner, Table, Td, Th } from '../components/ui'
import { formatDate } from '../lib/utils'

type BackupEntry = {
  filename: string
  sizeKb: number
  createdAt: string
  storage: 'drive' | 'local'
  driveUrl?: string
}

type ListResponse = { backups: BackupEntry[] }

type RunResponse = {
  ok: boolean
  filename: string
  backedUpAt: string
  storage: 'drive' | 'local'
  driveUrl?: string
  sizeKb: number
  collections: number
  documents: number
  durationMs: number
}

function formatBytes(kb: number) {
  if (kb < 1024) return `${kb} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function StorageBadge({ storage }: { storage: 'drive' | 'local' }) {
  return storage === 'drive'
    ? <Badge tone="blue"><CloudUpload size={10} className="inline mr-0.5" />Google Drive</Badge>
    : <Badge tone="gray"><HardDrive size={10} className="inline mr-0.5" />Local</Badge>
}

export default function Backup() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ['backup-list'],
    queryFn: () => api.get('/backup/list').then(r => r.data),
    refetchInterval: 60_000,
  })

  const [lastRun, setLastRun] = React.useState<RunResponse | null>(null)
  const [runError, setRunError] = React.useState('')

  const runNow = useMutation({
    mutationFn: () => api.post('/backup/run').then(r => r.data as RunResponse),
    onSuccess: (res) => {
      setLastRun(res)
      setRunError('')
      qc.invalidateQueries({ queryKey: ['backup-list'] })
    },
    onError: (e) => setRunError(apiError(e)),
  })

  const backups = data?.backups ?? []
  const latest  = backups[0]

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Database Backup</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automatic daily backup to Google Drive at 02:00 server time. All collections are exported and compressed.
          </p>
        </div>
        <Button onClick={() => { setRunError(''); runNow.mutate() }} disabled={runNow.isPending}>
          <RefreshCw size={14} className={runNow.isPending ? 'animate-spin' : ''} />
          {runNow.isPending ? 'Backing up…' : 'Back up now'}
        </Button>
      </div>

      {runError && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {runError}
        </div>
      )}

      {/* Last run result */}
      {lastRun && (
        <Card>
          <CardBody>
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                <Database size={16} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Backup complete</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {lastRun.filename} · {formatBytes(lastRun.sizeKb)} · {lastRun.collections} collections · {lastRun.documents.toLocaleString()} documents · {lastRun.durationMs}ms
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StorageBadge storage={lastRun.storage} />
                {lastRun.driveUrl && (
                  <a href={lastRun.driveUrl} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline"><ExternalLink size={12} /> Open</Button>
                  </a>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Status summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardBody>
            <div className="text-xs text-muted-foreground mb-1">Total backups</div>
            <div className="text-2xl font-bold">{backups.length}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-muted-foreground mb-1">Latest backup</div>
            <div className="text-sm font-semibold">
              {latest ? formatDate(latest.createdAt) : '—'}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-muted-foreground mb-1">On Google Drive</div>
            <div className="text-2xl font-bold text-blue-600">
              {backups.filter(b => b.storage === 'drive').length}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-muted-foreground mb-1">Local only</div>
            <div className="text-2xl font-bold text-muted-foreground">
              {backups.filter(b => b.storage === 'local').length}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Backup list */}
      <Card>
        <CardHeader title="Backup history" subtitle={`${backups.length} backup${backups.length !== 1 ? 's' : ''} found`} />
        {isLoading ? <div className="p-8 flex justify-center"><Spinner /></div>
          : backups.length === 0
            ? <EmptyState message="No backups yet. Click 'Back up now' to create the first one." />
            : (
              <Table>
                <thead>
                  <tr>
                    <Th>Filename</Th>
                    <Th>Date &amp; time</Th>
                    <Th>Size</Th>
                    <Th>Storage</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {backups.map(b => (
                    <tr key={b.filename} className="hover:bg-muted/50">
                      <Td className="font-mono text-xs">{b.filename}</Td>
                      <Td className="text-xs text-muted-foreground">
                        {new Date(b.createdAt).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </Td>
                      <Td className="text-xs">{formatBytes(b.sizeKb)}</Td>
                      <Td><StorageBadge storage={b.storage} /></Td>
                      <Td>
                        {b.driveUrl && (
                          <a href={b.driveUrl} target="_blank" rel="noreferrer"
                            className="text-primary text-xs hover:underline flex items-center gap-1">
                            <ExternalLink size={11} /> Open in Drive
                          </a>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
      </Card>
    </div>
  )
}

// inline React import for useState
import React from 'react'
