import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Send, Trash2, Pencil, ImagePlus } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Select, Spinner, Textarea } from '../components/ui'

const PURPLE = '#5B2BC9'
const MUTED = '#756E80'
const LINE = 'rgba(20,8,31,.10)'

type Btn = { type: 'QUICK_REPLY' | 'URL'; text: string; url: string }
type Tpl = {
  _id: string; name: string; language: string; category: 'MARKETING' | 'UTILITY'; headerType: 'none' | 'image'; imageUrl: string
  bodyText: string; bodyExamples: string[]; footerText: string; buttons: Btn[]
  status: string; rejectedReason: string; lastError: string; submittedAt: string | null; statusChangedAt: string | null; statusCheckedAt: string | null
  createdByName: string; problems: string[]
}

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : ''

const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft — not sent to Meta', tone: 'gray' },
  PENDING: { label: 'Waiting for Meta', tone: 'amber' },
  IN_APPEAL: { label: 'In appeal', tone: 'amber' },
  APPROVED: { label: 'Approved', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
  PAUSED: { label: 'Paused by Meta', tone: 'red' },
  DISABLED: { label: 'Disabled by Meta', tone: 'red' },
  DELETED: { label: 'Deleted on Meta', tone: 'gray' },
}

const blank = { name: '', language: 'en', category: 'MARKETING' as const, bodyText: '', bodyExamples: [] as string[], footerText: '', buttons: [] as Btn[] }

function Editor({ initial, onDone }: { initial: Tpl | null; onDone: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState(initial ? { name: initial.name, language: initial.language, category: initial.category, bodyText: initial.bodyText, bodyExamples: initial.bodyExamples, footerText: initial.footerText, buttons: initial.buttons } : blank)
  const [file, setFile] = useState<File | null>(null)
  const [keepImage, setKeepImage] = useState(!!initial?.imageUrl)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const vars = [...new Set([...f.bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
  const preview = file ? URL.createObjectURL(file) : keepImage ? initial?.imageUrl : ''

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData()
      form.append('name', f.name)
      form.append('language', f.language)
      form.append('category', f.category)
      form.append('bodyText', f.bodyText)
      form.append('footerText', f.footerText)
      form.append('bodyExamples', JSON.stringify(f.bodyExamples))
      form.append('buttons', JSON.stringify(f.buttons))
      form.append('headerType', file || keepImage ? 'image' : 'none')
      if (file) form.append('image', file)
      return initial ? api.put(`/campaign-templates/${initial._id}`, form) : api.post('/campaign-templates', form)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaign-templates'] }); onDone() },
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <Card>
      <CardHeader title={initial ? `Edit ${initial.name}` : 'New WhatsApp template'} subtitle="Save it here first, then send it to Meta when it reads right." />
      <CardBody className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Name (lowercase, underscores)">
            <Input value={f.name} disabled={!!initial} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="winback_offer_oct" />
          </Field>
          <Field label="Language">
            <Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
              <option value="en">English</option><option value="en_US">English (US)</option><option value="ar">Arabic</option>
            </Select>
          </Field>
          <Field label="Type">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as 'MARKETING' | 'UTILITY' })}>
              <option value="MARKETING">Marketing (offers, win-back)</option><option value="UTILITY">Utility (updates)</option>
            </Select>
          </Field>
        </div>

        <div>
          <div className="text-xs font-semibold mb-1">Image above the text (optional, JPG or PNG)</div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setKeepImage(false) }} />
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> {preview ? 'Change image' : 'Choose image'}</Button>
            {preview && <img src={preview} alt="" className="h-16 rounded-lg" style={{ border: `1px solid ${LINE}` }} />}
            {preview && <button type="button" className="text-xs underline cursor-pointer" style={{ color: MUTED }} onClick={() => { setFile(null); setKeepImage(false) }}>Remove</button>}
          </div>
        </div>

        <Field label="Message text — use {{1}} for the person's name, {{2}} for another detail">
          <Textarea rows={5} value={f.bodyText} onChange={(e) => setF({ ...f, bodyText: e.target.value })} placeholder={'Hi {{1}}, we have a special offer on storage this month…'} />
        </Field>
        {vars.length > 0 && (
          <div className="grid gap-2 md:grid-cols-3">
            {vars.map((n, i) => (
              <Field key={n} label={`Example for {{${n}}} (Meta reviewers see this)`}>
                <Input value={f.bodyExamples[i] ?? ''} onChange={(e) => { const x = [...f.bodyExamples]; x[i] = e.target.value; setF({ ...f, bodyExamples: x }) }} placeholder={n === 1 ? 'Sara' : 'Example'} />
              </Field>
            ))}
          </div>
        )}
        <Field label="Footer (optional, small grey text)">
          <Input value={f.footerText} maxLength={60} onChange={(e) => setF({ ...f, footerText: e.target.value })} placeholder="PurpleBox Self Storage" />
        </Field>

        <div className="space-y-2">
          <div className="text-xs font-semibold">Buttons (optional, up to 3)</div>
          {f.buttons.map((b, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Select value={b.type} onChange={(e) => { const x = [...f.buttons]; x[i] = { ...b, type: e.target.value as Btn['type'] }; setF({ ...f, buttons: x }) }}>
                <option value="QUICK_REPLY">Quick reply</option><option value="URL">Open a link</option>
              </Select>
              <Input value={b.text} maxLength={25} placeholder="Button text" onChange={(e) => { const x = [...f.buttons]; x[i] = { ...b, text: e.target.value }; setF({ ...f, buttons: x }) }} />
              {b.type === 'URL' && <Input value={b.url} placeholder="https://purplebox.ae/…" onChange={(e) => { const x = [...f.buttons]; x[i] = { ...b, url: e.target.value }; setF({ ...f, buttons: x }) }} />}
              <button type="button" className="cursor-pointer" onClick={() => setF({ ...f, buttons: f.buttons.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
          {f.buttons.length < 3 && <Button variant="outline" onClick={() => setF({ ...f, buttons: [...f.buttons, { type: 'QUICK_REPLY', text: '', url: '' }] })}><Plus size={13} /> Add button</Button>}
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex gap-2">
          <Button onClick={() => { setErr(''); save.mutate() }} disabled={save.isPending || !f.name || !f.bodyText.trim()}>Save draft</Button>
          <Button variant="outline" onClick={onDone}>Cancel</Button>
        </div>
      </CardBody>
    </Card>
  )
}

/** Templates written here, sent to Meta, and followed until Meta decides. */
export default function CampaignTemplates() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Tpl | 'new' | null>(null)
  const [err, setErr] = useState('')
  const { data, isLoading } = useQuery<Tpl[]>({
    queryKey: ['campaign-templates'],
    queryFn: () => api.get('/campaign-templates').then((r) => r.data),
    // Meta usually answers within minutes; keep the screen current while any is waiting.
    refetchInterval: (q) => ((q.state.data as Tpl[] | undefined)?.some((t) => t.status === 'PENDING') ? 60_000 : false),
  })
  const done = () => qc.invalidateQueries({ queryKey: ['campaign-templates'] })
  const submit = useMutation({ mutationFn: (id: string) => api.post(`/campaign-templates/${id}/submit`), onSuccess: done, onError: (e) => { setErr(apiError(e)); done() } })
  const refresh = useMutation({ mutationFn: () => api.post('/campaign-templates/refresh'), onSuccess: done, onError: (e) => setErr(apiError(e)) })
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/campaign-templates/${id}`), onSuccess: done })

  if (editing) return <Editor initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
  if (isLoading) return <Spinner />

  return (
    <Card>
      <CardHeader
        title="Your WhatsApp templates"
        subtitle="Write a template here and send it to Meta for review (a few minutes to about a day). The status below updates by itself."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshCw size={13} /> Check Meta now</Button>
            <Button onClick={() => setEditing('new')}><Plus size={13} /> New template</Button>
          </div>
        }
      />
      <CardBody className="space-y-3">
        {err && <p className="text-sm text-destructive">{err}</p>}
        {(data ?? []).length === 0 && <p className="text-sm" style={{ color: MUTED }}>No templates yet. Click "New template" to write your first one.</p>}
        {(data ?? []).map((t) => {
          const s = STATUS[t.status] ?? { label: t.status, tone: 'gray' }
          const editable = t.status === 'draft' || t.status === 'REJECTED'
          return (
            <div key={t._id} className="rounded-xl p-3 flex gap-3" style={{ border: `1px solid ${LINE}` }}>
              {t.imageUrl && <img src={t.imageUrl} alt="" className="h-20 w-20 rounded-lg object-cover shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{t.name}</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <span className="text-xs" style={{ color: MUTED }}>{t.category} · {t.language}</span>
                </div>
                <div className="text-[12.5px] mt-1 whitespace-pre-wrap line-clamp-3">{t.bodyText}</div>
                <div className="text-xs mt-1" style={{ color: MUTED }}>
                  {t.submittedAt && <>Sent to Meta {fmt(t.submittedAt)}. </>}
                  {t.status === 'APPROVED' && t.statusChangedAt && <>Approved {fmt(t.statusChangedAt)} — ready to use in a campaign. </>}
                  {t.status === 'PENDING' && t.statusCheckedAt && <>Last checked {fmt(t.statusCheckedAt)}. </>}
                </div>
                {t.status === 'REJECTED' && <p className="text-xs mt-1 text-destructive">Meta said: {t.rejectedReason || 'no reason given'}. Edit it and send again.</p>}
                {t.lastError && editable && <p className="text-xs mt-1 text-destructive">Meta refused it: {t.lastError}</p>}
                {editable && t.problems.length > 0 && <p className="text-xs mt-1" style={{ color: '#B45309' }}>To fix first: {t.problems[0]}</p>}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                {editable && <Button onClick={() => submit.mutate(t._id)} disabled={submit.isPending || t.problems.length > 0} style={{ background: PURPLE }}><Send size={13} /> Send to Meta</Button>}
                {editable && <Button variant="outline" onClick={() => setEditing(t)}><Pencil size={13} /> Edit</Button>}
                {t.status === 'draft' && <Button variant="outline" onClick={() => { if (confirm('Delete this draft?')) del.mutate(t._id) }}><Trash2 size={13} /> Delete</Button>}
              </div>
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}
