import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CloudUpload, Download, ExternalLink, HardDrive, History, RefreshCw, Upload, X, XCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Select, Spinner, Table, Td, Th } from '../components/ui'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type LogEntry = { at: string; msg: string; level: 'info' | 'ok' | 'error' }
type BackupResult = {
  filename: string; backedUpAt: string; storage: 'drive' | 'local'
  driveUrl?: string; sizeKb: number; collections: number; documents: number; durationMs: number
}
type RestoreStatus = {
  running: boolean; startedAt: string | null; filename: string
  logs: LogEntry[]; lastResult: { collections: number; documents: number; restoredAt: string; backupDate?: string } | null
  lastError: string
}
type StatusResponse = {
  running: boolean; startedAt: string | null; triggeredBy: string
  logs: LogEntry[]; lastResult: BackupResult | null; lastError: string
  restore?: RestoreStatus
}
type BackupConfig = { enabled: boolean; frequency: '6h' | '12h' | 'daily' | 'weekly'; hour: number; lastAutoAt?: string }
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

const FREQ_LABELS: Record<string, string> = {
  '6h': 'Every 6 hours', '12h': 'Every 12 hours', daily: 'Daily', weekly: 'Weekly',
}

export default function Backup() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [runError, setRunError] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState('')
  const [cfgDraft, setCfgDraft] = useState<BackupConfig | null>(null)
  const [cfgSaved, setCfgSaved] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const [, setTick] = useState(0)   // drives elapsed timer re-render
  const logRef = useRef<HTMLDivElement>(null)

  // Poll status (fast when running, slow otherwise)
  const { data: status, refetch: refetchStatus } = useQuery<StatusResponse>({
    queryKey: ['backup-status'],
    queryFn: () => api.get('/backup/status').then(r => r.data),
    refetchInterval: (query) => (query.state.data?.running ? 1500 : 15_000),
  })

  const { data: config } = useQuery<BackupConfig>({
    queryKey: ['backup-config'],
    queryFn: () => api.get('/backup/config').then(r => r.data),
  })
  useEffect(() => { if (config && !cfgDraft) setCfgDraft(config) }, [config, cfgDraft])

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

  async function saveConfig() {
    if (!cfgDraft) return
    setRunError('')
    try {
      await api.put('/backup/config', { enabled: cfgDraft.enabled, frequency: cfgDraft.frequency, hour: cfgDraft.hour })
      setCfgSaved(true)
      setTimeout(() => setCfgSaved(false), 2500)
      qc.invalidateQueries({ queryKey: ['backup-config'] })
    } catch (e) { setRunError(apiError(e)) }
  }

  async function downloadBackup(filename: string) {
    setRunError('')
    try {
      const r = await api.get(`/backup/download/${encodeURIComponent(filename)}`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/gzip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) { setRunError(apiError(e)) }
  }

  async function startRestore(filename: string) {
    setRunError('')
    try {
      await api.post('/backup/restore', { filename })
      setRestoreTarget(null)
      setRestoreConfirm('')
      refetchStatus()
    } catch (e) { setRunError(apiError(e)) }
  }

  async function restoreFromUpload(file: File) {
    setRunError('')
    try {
      const form = new FormData()
      form.append('file', file)
      await api.post('/backup/restore-upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      refetchStatus()
    } catch (e) { setRunError(apiError(e)) }
  }

  const restore = status?.restore
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
            {config?.enabled
              ? `Automatic ${FREQ_LABELS[config.frequency]?.toLowerCase() ?? 'daily'} backup to Google Drive${['daily', 'weekly'].includes(config.frequency) ? ` at ${String(config.hour).padStart(2, '0')}:00` : ''}. All collections exported and compressed.`
              : 'Automatic backups are OFF — only manual backups run.'}
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

      {/* Schedule settings */}
      <Card>
        <CardHeader title="Automatic backup schedule" subtitle="Changes apply immediately — the server checks every minute" />
        <CardBody className="pt-0">
          {!cfgDraft ? <Spinner /> : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Automatic backups">
                <Select value={cfgDraft.enabled ? 'on' : 'off'} disabled={!isAdmin}
                  onChange={(e) => setCfgDraft({ ...cfgDraft, enabled: e.target.value === 'on' })}>
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </Select>
              </Field>
              <Field label="Frequency">
                <Select value={cfgDraft.frequency} disabled={!isAdmin || !cfgDraft.enabled}
                  onChange={(e) => setCfgDraft({ ...cfgDraft, frequency: e.target.value as BackupConfig['frequency'] })}>
                  <option value="6h">Every 6 hours</option>
                  <option value="12h">Every 12 hours</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </Select>
              </Field>
              {['daily', 'weekly'].includes(cfgDraft.frequency) && (
                <Field label="At hour">
                  <Select value={String(cfgDraft.hour)} disabled={!isAdmin || !cfgDraft.enabled}
                    onChange={(e) => setCfgDraft({ ...cfgDraft, hour: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </Select>
                </Field>
              )}
              {isAdmin && (
                <Button onClick={saveConfig}>{cfgSaved ? 'Saved ✓' : 'Save schedule'}</Button>
              )}
              {config?.lastAutoAt && (
                <span className="text-xs text-muted-foreground pb-2.5">
                  Last automatic run: {formatDate(config.lastAutoAt)}
                </span>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Restore progress / result */}
      {restore && (restore.running || restore.logs.length > 0) && (
        <Card>
          <CardBody className="p-0">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b">
              {restore.running ? (
                <>
                  <span className="inline-block h-2 w-2 rounded-full bg-red-400 animate-pulse" />
                  <span className="text-sm font-medium">Restore in progress — do not close the server</span>
                </>
              ) : restore.lastError ? (
                <><XCircle size={14} className="text-destructive" /><span className="text-sm font-medium text-destructive">Restore failed</span></>
              ) : (
                <>
                  <History size={14} className="text-emerald-500" />
                  <span className="text-sm font-medium">Restore complete</span>
                  {restore.lastResult && (
                    <span className="text-xs text-muted-foreground">
                      — {restore.lastResult.collections} collections · {restore.lastResult.documents.toLocaleString()} docs restored
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="bg-slate-950 rounded-b-lg font-mono text-xs p-4 space-y-0.5 max-h-72 overflow-y-auto">
              {restore.logs.map((entry, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-slate-500 shrink-0 select-none">
                    {new Date(entry.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={logColor(entry.level)}>{entry.msg}</span>
                </div>
              ))}
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
                        <div className="flex items-center gap-3">
                          <button type="button" onClick={() => downloadBackup(b.filename)}
                            className="text-primary text-xs hover:underline flex items-center gap-1 cursor-pointer">
                            <Download size={11} /> Download
                          </button>
                          {b.driveUrl && (
                            <a href={b.driveUrl} target="_blank" rel="noreferrer"
                              className="text-primary text-xs hover:underline flex items-center gap-1">
                              <ExternalLink size={11} /> Drive
                            </a>
                          )}
                          {isAdmin && (
                            <button type="button"
                              onClick={() => { setRestoreTarget(b.filename); setRestoreConfirm('') }}
                              disabled={running || restore?.running}
                              className="text-destructive text-xs hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-40">
                              <History size={11} /> Restore
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
      </Card>

      {/* Restore from a downloaded backup file */}
      {isAdmin && (
        <Card>
          <CardBody className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Restore from a file</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Upload a previously downloaded .json.gz backup and restore the database from it.
              </div>
            </div>
            <input ref={uploadRef} type="file" accept=".gz,application/gzip" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f && confirm(`Restore the database from "${f.name}"? Current data is safety-backed-up first, then REPLACED.`)) restoreFromUpload(f); e.target.value = '' }} />
            <Button variant="outline" disabled={running || restore?.running}
              onClick={() => uploadRef.current?.click()}>
              <Upload size={14} /> Upload &amp; restore
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Restore confirmation */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setRestoreTarget(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-destructive">Restore database</h2>
              <button onClick={() => setRestoreTarget(null)} className="p-1 hover:bg-muted rounded cursor-pointer"><X size={16} /></button>
            </div>
            <p className="text-sm">
              This replaces the <strong>entire database</strong> with the contents of
              <span className="font-mono text-xs block mt-1">{restoreTarget}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              A safety backup of the current data is taken automatically first, so this can be undone by
              restoring that safety backup.
            </p>
            <Field label='Type RESTORE to confirm'>
              <input value={restoreConfirm} onChange={(e) => setRestoreConfirm(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-destructive"
                placeholder="RESTORE" autoFocus />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setRestoreTarget(null)}>Cancel</Button>
              <Button
                className="bg-destructive hover:bg-destructive/90"
                disabled={restoreConfirm !== 'RESTORE'}
                onClick={() => startRestore(restoreTarget)}>
                Restore now
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
