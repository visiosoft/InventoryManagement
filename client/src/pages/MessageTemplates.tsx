import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Mail, MessageSquare, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Button, Card, CardBody, CardHeader, PageHeader, Spinner, Textarea, Field, Input, Select } from '../components/ui'

type Template = {
  _id: string
  key: string
  label: string
  subject: string
  emailBody: string
  whatsappBody: string
  /* The name Meta approved this under, if it has one. Without it a reminder
     can only reach somebody who wrote to us in the last 24 hours. */
  whatsappTemplate?: string
  whatsappTemplateLang?: string
  whatsappTemplateVars?: string[]
  variables: string[]
}

type QuickReply = {
  _id: string
  key: string
  label: string
  category?: string
  whatsappBody: string
  sortOrder?: number
  kind?: string
  // A quick reply can send a file as well as text.
  mediaUrl?: string
  mediaKind?: '' | 'image' | 'video' | 'audio' | 'document'
}

const UNCATEGORISED = 'Uncategorised'

function slugKey(label: string) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `qr_${base || 'reply'}`
}

function statusOf(e: unknown) {
  return (e as { response?: { status?: number } })?.response?.status
}

export default function MessageTemplates() {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'templates' | 'quick'>('templates')
  const [selected, setSelected] = useState<Template | null>(null)
  const [tab, setTab] = useState<'email' | 'whatsapp'>('email')
  const [subject, setSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [whatsappBody, setWhatsappBody] = useState('')
  const [waTemplate, setWaTemplate] = useState('')
  const [waLang, setWaLang] = useState('en')
  const [waVars, setWaVars] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [creating, setCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newKey, setNewKey] = useState('')

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ['message-templates'],
    queryFn: () => api.get('/message-templates').then(r => r.data),
  })

  const DEFAULT_KEYS = ['welcome', 'contract_signed', 'payment_received', 'payment_reminder', 'contract_expiring', 'contract_ended']

  const updateMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.put(`/message-templates/${selected!._id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['message-templates'], exact: true }); setSuccess('Saved!'); setError(''); setTimeout(() => setSuccess(''), 2000) },
    onError: (e) => setError(apiError(e)),
  })

  const createMut = useMutation({
    mutationFn: (body: { key: string; label: string }) =>
      api.post('/message-templates', body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['message-templates'], exact: true })
      setCreating(false); setNewLabel(''); setNewKey('')
      selectTemplate(res.data as Template)
    },
    onError: (e) => setError(apiError(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/message-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['message-templates'], exact: true })
      setSelected(null); setSuccess('Deleted'); setTimeout(() => setSuccess(''), 2000)
    },
    onError: (e) => setError(apiError(e)),
  })

  const resetMut = useMutation({
    mutationFn: (key: string) => api.post(`/message-templates/${key}/reset`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['message-templates'], exact: true })
      const t = res.data as Template
      setSubject(t.subject); setEmailBody(t.emailBody); setWhatsappBody(t.whatsappBody)
      setWaTemplate(t.whatsappTemplate || ''); setWaLang(t.whatsappTemplateLang || 'en')
      setWaVars((t.whatsappTemplateVars || []).join(', '))
      setSuccess('Reset to default'); setTimeout(() => setSuccess(''), 2000)
    },
    onError: (e) => setError(apiError(e)),
  })

  /* ---------- WhatsApp quick replies ---------- */
  const [qrDrafts, setQrDrafts] = useState<Record<string, { label: string; category: string; whatsappBody: string; sortOrder: number; mediaUrl: string; mediaKind: string }>>({})
  const [qrSelectedId, setQrSelectedId] = useState<string | null>(null)
  const [qrAdding, setQrAdding] = useState(false)
  const [qrLabel, setQrLabel] = useState('')
  const [qrCategory, setQrCategory] = useState('')
  const [qrBody, setQrBody] = useState('')
  const [qrSort, setQrSort] = useState('0')

  const { data: quickReplies = [], isLoading: qrLoading } = useQuery<QuickReply[]>({
    queryKey: ['message-templates', 'quick_reply'],
    queryFn: () => api.get('/message-templates', { params: { kind: 'quick_reply' } }).then(r => r.data),
  })

  const invalidateQuick = () => qc.invalidateQueries({ queryKey: ['message-templates', 'quick_reply'] })

  const qrCategories = Array.from(new Set(quickReplies.map(q => (q.category || '').trim()).filter(Boolean))).sort()

  const qrGroups = (() => {
    const map = new Map<string, QuickReply[]>()
    for (const q of quickReplies) {
      const cat = (q.category || '').trim() || UNCATEGORISED
      const list = map.get(cat)
      if (list) list.push(q)
      else map.set(cat, [q])
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0] === UNCATEGORISED ? 1 : b[0] === UNCATEGORISED ? -1 : a[0].localeCompare(b[0]))
  })()

  function qrDraft(q: QuickReply) {
    return qrDrafts[q._id] ?? {
      label: q.label,
      category: q.category || '',
      whatsappBody: q.whatsappBody || '',
      sortOrder: q.sortOrder ?? 0,
      mediaUrl: q.mediaUrl || '',
      mediaKind: q.mediaKind || '',
    }
  }

  function setQrDraft(q: QuickReply, patch: Partial<{ label: string; category: string; whatsappBody: string; sortOrder: number; mediaUrl: string; mediaKind: string }>) {
    setQrDrafts(prev => ({ ...prev, [q._id]: { ...qrDraft(q), ...patch } }))
  }

  const qrCreateMut = useMutation({
    mutationFn: async (body: { label: string; category: string; whatsappBody: string; sortOrder: number }) => {
      const base = slugKey(body.label)
      for (let attempt = 0; attempt < 25; attempt++) {
        const key = attempt === 0 ? base : `${base}_${attempt + 1}`
        try {
          const res = await api.post('/message-templates', { ...body, key, kind: 'quick_reply' })
          return res.data as QuickReply
        } catch (e) {
          if (statusOf(e) === 409) continue
          throw e
        }
      }
      throw new Error('Could not find a free key for this quick reply — try a different label.')
    },
    onSuccess: () => {
      invalidateQuick()
      setQrAdding(false); setQrLabel(''); setQrCategory(''); setQrBody(''); setQrSort('0')
      setError(''); setSuccess('Quick reply added'); setTimeout(() => setSuccess(''), 2000)
    },
    onError: (e) => setError(apiError(e)),
  })

  const qrUpdateMut = useMutation({
    mutationFn: (v: { id: string; label: string; category: string; whatsappBody: string; sortOrder: number; mediaUrl: string; mediaKind: string }) =>
      api.put(`/message-templates/${v.id}`, {
        label: v.label, category: v.category, whatsappBody: v.whatsappBody, sortOrder: v.sortOrder,
        // Clearing the kind clears the URL too, or a disabled field keeps a
        // stale link that would be sent the next time a kind is chosen.
        mediaKind: v.mediaKind, mediaUrl: v.mediaKind ? v.mediaUrl : '',
      }),
    onSuccess: (_res, v) => {
      invalidateQuick()
      setQrDrafts(prev => { const next = { ...prev }; delete next[v.id]; return next })
      setError(''); setSuccess('Saved!'); setTimeout(() => setSuccess(''), 2000)
    },
    onError: (e) => setError(apiError(e)),
  })

  const qrDeleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/message-templates/${id}`),
    onSuccess: (_res, id) => {
      invalidateQuick()
      setQrDrafts(prev => { const next = { ...prev }; delete next[id]; return next })
      setError(''); setSuccess('Deleted'); setTimeout(() => setSuccess(''), 2000)
    },
    onError: (e) => setError(apiError(e)),
  })

  function switchMode(m: 'templates' | 'quick') {
    setMode(m); setError(''); setSuccess('')
  }

  function selectTemplate(t: Template) {
    setSelected(t)
    setSubject(t.subject)
    setEmailBody(t.emailBody)
    setWhatsappBody(t.whatsappBody)
    setError(''); setSuccess('')
  }

  return (
    <div>
      <PageHeader title="Message Templates"
        subtitle={mode === 'templates'
          ? 'Edit email and WhatsApp templates for automated messages'
          : 'Manage the canned replies shown in the WhatsApp console'} />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b">
        <span className="px-1 pb-3 text-sm font-bold text-primary border-b-2 border-primary -mb-px mr-5">
          Message Templates
        </span>
        <Link to="/settings/automation"
          className="px-1 pb-3 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Automation Rules
        </Link>
      </div>

      {/* Mode switch */}
      <div className="flex rounded-lg border overflow-hidden text-sm mb-5 max-w-lg">
        <button onClick={() => switchMode('templates')}
          className={`flex-1 py-2 px-3 font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${mode === 'templates' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
          <Mail size={14} /> Contract templates
        </button>
        <button onClick={() => switchMode('quick')}
          className={`flex-1 py-2 px-3 font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${mode === 'quick' ? 'bg-emerald-600 text-white' : 'hover:bg-muted text-muted-foreground'}`}>
          <MessageSquare size={14} /> WhatsApp quick replies
        </button>
      </div>

      {mode === 'quick' ? (
        qrLoading ? <Spinner /> : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground rounded-lg border border-dashed px-4 py-3">
            These replies appear in the quick-replies panel of the WhatsApp console. Placeholders such as
            {' '}<span className="font-mono text-foreground">@name</span>{' '}are <strong>not</strong> substituted there —
            the console only has a phone number, not a contract, so anything you type is sent exactly as written.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
            {/* List, grouped by category — the same shape as contract templates */}
            <div className="space-y-3">
              {qrGroups.map(([category, items]) => (
                <div key={category} className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                    {category} <span className="opacity-60">{items.length}</span>
                  </div>
                  {items.map(q => (
                    <button
                      key={q._id}
                      onClick={() => { setQrSelectedId(q._id); setQrAdding(false); setError(''); setSuccess('') }}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors cursor-pointer ${qrSelectedId === q._id && !qrAdding ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                    >
                      <div className="font-medium text-sm">{q.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {q.whatsappBody || 'No message yet'}
                      </div>
                    </button>
                  ))}
                </div>
              ))}

              <button
                onClick={() => { setQrAdding(true); setQrSelectedId(null); setError(''); setSuccess('') }}
                className={`w-full rounded-lg border border-dashed px-4 py-3 text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${qrAdding ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
              >
                <Plus size={14} /> New Quick Reply
              </button>
            </div>

            {/* Editor */}
            {qrAdding ? (
              <Card>
                <CardHeader title="New quick reply" subtitle="The key is generated from the label" />
                <CardBody className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_100px] gap-3">
                    <Field label="Label">
                      <Input value={qrLabel} onChange={e => setQrLabel(e.target.value)} placeholder="e.g. Opening hours" autoFocus />
                    </Field>
                    <Field label="Category">
                      <Input list="qr-categories" value={qrCategory} onChange={e => setQrCategory(e.target.value)} placeholder="Reuse an existing one" />
                    </Field>
                    <Field label="Order">
                      <Input type="number" value={qrSort} onChange={e => setQrSort(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Message">
                    <Textarea rows={6} value={qrBody} onChange={e => setQrBody(e.target.value)}
                      placeholder="What staff should be able to send in one click" />
                  </Field>
                  {error && <p className="text-xs text-destructive">{error}</p>}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => qrCreateMut.mutate({
                        label: qrLabel.trim(), category: qrCategory.trim(),
                        whatsappBody: qrBody, sortOrder: Number(qrSort) || 0,
                      })}
                      disabled={!qrLabel.trim() || !qrBody.trim() || qrCreateMut.isPending}
                    >
                      <Plus size={14} /> {qrCreateMut.isPending ? 'Adding…' : 'Add quick reply'}
                    </Button>
                    <Button variant="outline" onClick={() => { setQrAdding(false); setError('') }}>Cancel</Button>
                  </div>
                </CardBody>
              </Card>
            ) : (() => {
              const q = quickReplies.find(x => x._id === qrSelectedId)
              if (!q) {
                return (
                  <Card>
                    <CardBody className="py-16 text-center text-muted-foreground">
                      <MessageSquare size={30} className="mx-auto mb-3 opacity-40" />
                      <p className="text-sm">Select a quick reply from the left to edit</p>
                    </CardBody>
                  </Card>
                )
              }
              const draft = qrDraft(q)
              const dirty = draft.label !== q.label
                || draft.category !== (q.category || '')
                || draft.whatsappBody !== (q.whatsappBody || '')
                || draft.sortOrder !== (q.sortOrder ?? 0)
              return (
                <Card>
                  <CardHeader title={q.label} subtitle={`Key: ${q.key}`} />
                  <CardBody className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_100px] gap-3">
                      <Field label="Label">
                        <Input value={draft.label} onChange={e => setQrDraft(q, { label: e.target.value })} />
                      </Field>
                      <Field label="Category">
                        <Input list="qr-categories" value={draft.category} onChange={e => setQrDraft(q, { category: e.target.value })} />
                      </Field>
                      <Field label="Order">
                        <Input type="number" value={String(draft.sortOrder)}
                          onChange={e => setQrDraft(q, { sortOrder: Number(e.target.value) || 0 })} />
                      </Field>
                    </div>
                    <Field label="Message">
                      <Textarea rows={8} value={draft.whatsappBody}
                        onChange={e => setQrDraft(q, { whatsappBody: e.target.value })} />
                    </Field>

                    {/* A file is sent by URL, so WhatsApp fetches it itself.
                        Nothing to upload, and no media id to keep alive. */}
                    <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
                      <Field label="Attach a file">
                        <Select value={draft.mediaKind} onChange={e => setQrDraft(q, { mediaKind: e.target.value })}>
                          <option value="">No file</option>
                          <option value="video">Video</option>
                          <option value="image">Image</option>
                          <option value="document">Document</option>
                          <option value="audio">Audio</option>
                        </Select>
                      </Field>
                      <Field label="File URL (must be publicly reachable)">
                        <Input
                          value={draft.mediaUrl}
                          disabled={!draft.mediaKind}
                          onChange={e => setQrDraft(q, { mediaUrl: e.target.value })}
                          placeholder="https://office.purplebox.ae/office-tour-wa.mp4"
                        />
                      </Field>
                    </div>
                    {draft.mediaKind && (
                      <p className="text-xs text-muted-foreground">
                        WhatsApp limits: 16 MB video and audio, 5 MB images, 100 MB documents. Over that, the
                        message is rejected rather than shrunk. The message text above is sent as the caption.
                      </p>
                    )}
                    {error && <p className="text-xs text-destructive">{error}</p>}
                    {success && <p className="text-xs text-emerald-600 font-medium">{success}</p>}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-2">
                        <Button
                          onClick={() => qrUpdateMut.mutate({ id: q._id, ...draft })}
                          disabled={!dirty || qrUpdateMut.isPending}
                        >
                          <Save size={14} /> {qrUpdateMut.isPending ? 'Saving…' : 'Save'}
                        </Button>
                        {dirty && (
                          <Button variant="outline"
                            onClick={() => setQrDrafts(prev => { const n = { ...prev }; delete n[q._id]; return n })}>
                            <RotateCcw size={14} /> Revert
                          </Button>
                        )}
                      </div>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          if (!confirm(`Delete "${q.label}"? This cannot be undone.`)) return
                          qrDeleteMut.mutate(q._id)
                          setQrSelectedId(null)
                        }}
                        disabled={qrDeleteMut.isPending}
                      >
                        <Trash2 size={14} /> Delete
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              )
            })()}
          </div>

          <datalist id="qr-categories">
            {qrCategories.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        )
      ) : isLoading ? <Spinner /> : (
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        {/* Template list */}
        <div className="space-y-1.5" data-tour="templates-list">
          {templates.map(t => (
            <button key={t._id} onClick={() => selectTemplate(t)}
              className={`w-full text-left rounded-lg border px-4 py-3 transition-colors cursor-pointer ${selected?._id === t._id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
              <div className="font-medium text-sm">{t.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Key: {t.key}</div>
            </button>
          ))}

          {/* Create new template */}
          {creating ? (
            <div className="rounded-lg border border-dashed border-primary/40 p-3 space-y-2">
              <Input
                placeholder="Template name"
                value={newLabel}
                onChange={(e) => {
                  setNewLabel(e.target.value)
                  setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
                }}
                autoFocus
              />
              <Input
                placeholder="Key (auto-generated)"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                className="text-xs font-mono"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => createMut.mutate({ key: newKey, label: newLabel })} disabled={!newKey || !newLabel || createMut.isPending}>
                  Create
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setCreating(false); setNewLabel(''); setNewKey('') }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer"
            >
              <Plus size={14} /> New Template
            </button>
          )}
        </div>

        {/* Editor */}
        {selected ? (
          <Card>
            <CardHeader title={selected.label} subtitle={`Template: ${selected.key}`}
              action={
                <div className="flex gap-2">
                  {!DEFAULT_KEYS.includes(selected.key) && (
                    <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Delete template "${selected.label}"?`)) deleteMut.mutate(selected._id) }} disabled={deleteMut.isPending}>
                      <Trash2 size={13} /> Delete
                    </Button>
                  )}
                  {DEFAULT_KEYS.includes(selected.key) && (
                    <Button size="sm" variant="outline" onClick={() => resetMut.mutate(selected.key)} disabled={resetMut.isPending}>
                      <RotateCcw size={13} /> Reset
                    </Button>
                  )}
                  <Button size="sm" onClick={() => updateMut.mutate({
                    subject, emailBody, whatsappBody,
                    whatsappTemplate: waTemplate.trim(),
                    whatsappTemplateLang: waLang.trim() || 'en',
                    whatsappTemplateVars: waVars,
                  })} disabled={updateMut.isPending}>
                    <Save size={13} /> {updateMut.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              }
            />
            <CardBody className="space-y-4">
              {/* Variables */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1.5">Available variables (click to copy)</div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.variables.map(v => (
                    <button key={v} onClick={() => navigator.clipboard.writeText(v)}
                      className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded cursor-pointer hover:bg-primary/20 transition-colors">
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab toggle */}
              <div className="flex rounded-lg border overflow-hidden text-sm">
                <button onClick={() => setTab('email')}
                  className={`flex-1 py-2 font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${tab === 'email' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
                  <Mail size={14} /> Email
                </button>
                <button onClick={() => setTab('whatsapp')}
                  className={`flex-1 py-2 font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${tab === 'whatsapp' ? 'bg-emerald-600 text-white' : 'hover:bg-muted text-muted-foreground'}`}>
                  <MessageSquare size={14} /> WhatsApp
                </button>
              </div>

              {tab === 'email' ? (
                <div className="space-y-3">
                  <Field label="Subject">
                    <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject line..." />
                  </Field>
                  <Field label="Body">
                    <Textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={12} className="font-mono text-sm" placeholder="Email body..." />
                  </Field>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Named first, because whether this is set decides whether
                      the message below is ever sent. */}
                  <div className="rounded-lg border p-3" style={{ background: '#F7F3FF', borderColor: '#DDD0FF' }}>
                    <div className="text-xs font-semibold" style={{ color: '#4A1FA0' }}>Approved template</div>
                    <p className="text-[11px] mt-0.5 mb-2 text-muted-foreground">
                      WhatsApp only allows free text within 24 hours of the customer's last message. A reminder
                      to somebody who has not written needs the name Meta approved, or it is rejected rather than
                      delivered.
                    </p>
                    <Input
                      value={waTemplate}
                      onChange={e => setWaTemplate(e.target.value)}
                      placeholder="contract_expiry_notification"
                    />
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <Input value={waLang} onChange={e => setWaLang(e.target.value)} placeholder="en" />
                      <div className="col-span-2">
                        <Input
                          value={waVars}
                          onChange={e => setWaVars(e.target.value)}
                          placeholder="name, contractNo, unit, endDate"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] mt-1.5 text-muted-foreground">
                      Language, then the variables filling <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code> … <b>in that order</b>.
                    </p>
                  </div>

                  <Field label="WhatsApp Message">
                    <Textarea value={whatsappBody} onChange={e => setWhatsappBody(e.target.value)} rows={10} className="font-mono text-sm" placeholder="WhatsApp message..." />
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    Use *text* for bold in WhatsApp.
                    {waTemplate.trim() && ' While an approved template is set, this wording is not what goes out — it is kept for the log and as the fallback inside the 24-hour window.'}
                  </p>
                </div>
              )}

              {/* Preview */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-semibold text-muted-foreground mb-2">Preview</div>
                {tab === 'email' ? (
                  <div>
                    <div className="text-sm font-medium mb-1">{subject.replace(/@\w+/g, '<span class="text-primary">$&</span>')}</div>
                    <div className="text-sm whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: emailBody.replace(/@\w+/g, '<span style="color:#5B2BC9;font-weight:600">$&</span>') }} />
                  </div>
                ) : (
                  <div className="text-sm whitespace-pre-wrap bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-3 border border-emerald-200 dark:border-emerald-900"
                    dangerouslySetInnerHTML={{ __html: whatsappBody.replace(/\*(.*?)\*/g, '<strong>$1</strong>').replace(/@\w+/g, '<span style="color:#059669;font-weight:600">$&</span>') }} />
                )}
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
              {success && <p className="text-xs text-emerald-600 font-medium">{success}</p>}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody className="py-16 text-center">
              <Mail size={32} className="mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Select a template from the left to edit</p>
            </CardBody>
          </Card>
        )}
      </div>
      )}
    </div>
  )
}
