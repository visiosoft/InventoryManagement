import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CloudUpload, ExternalLink, HardDrive, RefreshCw, XCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Spinner, Table, Td, Th } from '../components/ui'
import { formatDate } from '../lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type LogEntry = { at: string; msg: string; level: 'info' | 'ok' | 'error' }
type BackupResult = {
  filename: string; backedUpAt: string; storage: 'drive' | 'local'
  driveUrl?: string; sizeKb: number; collections: number; documents: number; durationMs: number
}
type StatusResponse = {
  running: boolean; startedAt: string | null; triggeredBy: string
  logs: LogEntry[]; lastResult: BackupResult | null; lastError: string
}
type BackupEntry = {
  filename: string; sizeKb: number; createdAt: string
  storage: 'drive' | 'local'; driveUrl?: string
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function formatBytes(kb: number) {
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`
}

function elapsed(from: string) {
  const s = Math.floor((Date.now() - new Date(from).getTime()) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function StorageBadge({ storage }: { storage: 'drive' | 'local' }) {
  return storage === 'drive'
    ? <Badge tone="blue"><CloudUpload size={10} className="inline mr-0.5" />Google Drive</Badge>
    : <Badge tone="gray"><HardDrive size={10} className="inline mr-0.5" />Local only</Badge>
}

function logColor(level: string) {
  if (level === 'ok') return 'text-emerald-400'
  if (level === 'error') return 'text-red-400'
  return 'text-slate-300'
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Backup() {
  const qc = useQueryClient()
  const [runError, setRunError] = useState('')
  const [, setTick] = useState(0)   // drives elapsed timer re-render
  const logRef = useRef<HTMLDivElement>(null)

  // Poll status (fast when running, slow otherwise)
  const { data: status, refetch: refetchStatus } = useQuery<StatusResponse>({
    queryKey: ['backup-status'],
    queryFn: () => api.get('/backup/status').then(r => r.data),
    refetchInterval: (query) => (query.state.data?.running ? 1500 : 15_000),
  })

  // Backup history list
  const { data: listData, isLoading: listLoading } = useQuery<{ backups: BackupEntry[] }>({
    queryKey: ['backup-list'],
    queryFn: () => api.get('/backup/list').then(r => r.data),
    refetchInterval: status?.running ? 5_000 : 60_000,
  })

  // Elapsed timer while running
  useEffect(() => {
    if (!status?.running) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [status?.running])

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [status?.logs?.length])

  // When backup finishes (running → false), refresh history
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && status && !status.running) {
      qc.invalidateQueries({ queryKey: ['backup-list'] })
    }
    wasRunning.current = status?.running ?? false
  }, [status?.running])

  async function startBackup() {
    setRunError('')
    try {
      await api.post('/backup/run')
      refetchStatus()
    } catch (e) {
      setRunError(apiError(e))
    }
  }

  const backups = listData?.backups ?? []
  const running = status?.running ?? false
  const lastResult = status?.lastResult
  const lastError = status?.lastError

  return (
    <div className="max-w-4xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Database Backup</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automatic daily backup to Google Drive at 02:00 server time. All collections exported and compressed.
          </p>
        </div>
        <Button onClick={startBackup} disabled={running}>
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Backup running…' : 'Back up now'}
        </Button>
      </div>

      {runError && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {runError}
        </div>
      )}

      {/* Live log panel — visible while running OR if there are logs from last run */}
      {(running || (status?.logs?.length ?? 0) > 0) && (
        <Card>
          <CardBody className="p-0">
            {/* Log header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b">
              <div className="flex items-center gap-2">
                {running ? (
                  <>
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-sm font-medium">Backup in progress</span>
                    {status?.startedAt && (
                      <span className="text-xs text-muted-foreground">
                        — {elapsed(status.startedAt)} elapsed
                      </span>
                    )}
                  </>
                ) : lastError ? (
                  <>
                    <XCircle size={14} className="text-destructive" />
                    <span className="text-sm font-medium text-destructive">Backup failed</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span className="text-sm font-medium">Backup complete</span>
                    {lastResult && (
                      <span className="text-xs text-muted-foreground">
                        — {lastResult.collections} collections · {lastResult.documents.toLocaleString()} docs · {formatBytes(lastResult.sizeKb)} · {(lastResult.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </>
                )}
              </div>
              {lastResult?.driveUrl && !running && (
                <a href={lastResult.driveUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline"><ExternalLink size={12} /> Open in Drive</Button>
                </a>
              )}
            </div>

            {/* Log lines */}
            <div
              ref={logRef}
              className="bg-slate-950 rounded-b-lg font-mono text-xs p-4 space-y-0.5 max-h-72 overflow-y-auto"
            >
              {(status?.logs ?? []).map((entry, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-slate-500 shrink-0 select-none">
                    {new Date(entry.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={logColor(entry.level)}>{entry.msg}</span>
                </div>
              ))}
              {running && (
                <div className="flex gap-3">
                  <span className="text-slate-500 select-none">···</span>
                  <span className="text-slate-400 animate-pulse">waiting…</span>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Summary cards */}
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
              {backups[0] ? formatDate(backups[0].createdAt) : '—'}
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

      {/* History table */}
      <Card>
        <CardHeader
          title="Backup history"
          subtitle={`${backups.length} backup${backups.length !== 1 ? 's' : ''} found`}
        />
        {listLoading
          ? <div className="p-8 flex justify-center"><Spinner /></div>
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
