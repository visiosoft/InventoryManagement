import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Eye, Star } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Button, Card, CardBody, Input, PageHeader, Spinner } from '../components/ui'
import { formatDate } from '../lib/utils'

type TemplateRow = { _id: string; name: string; isDefault: boolean; updatedAt?: string; updatedBy?: string }
type TemplateFull = TemplateRow & { body: string }

/**
 * Design agreements and notices in the app. The editor is rich text: pasting
 * from Word keeps tables, bold, headings — and the PDF renders them. One
 * template is marked as the contract agreement default; the rest (expiry
 * notice, payment reminder, …) are reusable documents.
 */
export default function AgreementTemplate() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [newTplOpen, setNewTplOpen] = useState(false)
  const [newTplName, setNewTplName] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery<{ templates: TemplateRow[]; placeholders: string[] }>({
    queryKey: ['agreement-templates'],
    queryFn: () => api.get('/agreement-template').then((r) => r.data),
  })
  const templates = data?.templates ?? []

  // Auto-select the default (or first) template
  useEffect(() => {
    if (!selectedId && templates.length) {
      setSelectedId((templates.find((t) => t.isDefault) ?? templates[0])._id)
    }
  }, [templates, selectedId])

  const { data: current } = useQuery<TemplateFull>({
    queryKey: ['agreement-template', selectedId],
    queryFn: () => api.get(`/agreement-template/${selectedId}`).then((r) => r.data),
    enabled: !!selectedId,
  })

  // Load the body into the editor when switching templates
  useEffect(() => {
    if (current && editorRef.current) {
      editorRef.current.innerHTML = current.body || ''
      setName(current.name)
      setDirty(false)
    }
  }, [current])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['agreement-templates'] })
    qc.invalidateQueries({ queryKey: ['agreement-template', selectedId] })
  }

  const createTpl = useMutation({
    mutationFn: (tplName: string) => api.post('/agreement-template', { name: tplName, body: '' }).then((r) => r.data),
    onSuccess: (tpl) => { invalidate(); setSelectedId(tpl._id); setError(''); setNewTplOpen(false); setNewTplName('') },
    onError: (e) => setError(apiError(e)),
  })

  const saveTpl = useMutation({
    mutationFn: () => api.put(`/agreement-template/${selectedId}`, {
      name: name.trim() || current?.name || 'Untitled',
      body: editorRef.current?.innerHTML ?? '',
    }),
    onSuccess: () => { setDirty(false); setError(''); invalidate() },
    onError: (e) => setError(apiError(e)),
  })

  const makeDefault = useMutation({
    mutationFn: (id: string) => api.put(`/agreement-template/${id}`, { isDefault: true }),
    onSuccess: invalidate,
    onError: (e) => setError(apiError(e)),
  })

  const deleteTpl = useMutation({
    mutationFn: (id: string) => api.delete(`/agreement-template/${id}`),
    onSuccess: () => { setSelectedId(null); invalidate() },
    onError: (e) => setError(apiError(e)),
  })

  const insertPlaceholder = (p: string) => {
    editorRef.current?.focus()
    document.execCommand('insertText', false, `{{${p}}}`)
    setDirty(true)
  }

  const previewPdf = async () => {
    if (!selectedId) return
    if (dirty) await saveTpl.mutateAsync()
    try {
      const r = await api.get(`/agreement-template/${selectedId}/preview-pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }))
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) { setError(apiError(e)) }
  }

  if (isLoading) return <Spinner />

  return (
    <div>
      <PageHeader
        title="Document Templates"
        subtitle="Agreements and notices, designed here — paste from Word and the tables, bold and headings carry into the PDF"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={previewPdf} disabled={!selectedId}>
              <Eye size={14} /> Preview PDF
            </Button>
            <Button onClick={() => saveTpl.mutate()} disabled={!selectedId || saveTpl.isPending || !dirty}>
              {saveTpl.isPending ? 'Saving…' : dirty ? 'Save template' : 'Saved'}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
        {/* Template list */}
        <Card className="w-full lg:w-72 lg:shrink-0">
          <CardBody className="pt-4 space-y-1.5">
            {templates.map((t) => (
              <div key={t._id}
                onClick={() => setSelectedId(t._id)}
                className={`rounded-lg border px-3 py-2 cursor-pointer text-sm flex items-center justify-between gap-2 ${selectedId === t._id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}>
                <span className="min-w-0">
                  <span className="font-semibold block break-words">{t.name}</span>
                  {t.updatedAt && <span className="text-[10.5px] text-muted-foreground">{formatDate(t.updatedAt)}</span>}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <button type="button" title={t.isDefault ? 'Used for contract agreements' : 'Use for contract agreements'}
                    onClick={(e) => { e.stopPropagation(); if (!t.isDefault) makeDefault.mutate(t._id) }}
                    className={`p-1 rounded cursor-pointer ${t.isDefault ? 'text-amber-500' : 'text-muted-foreground/40 hover:text-amber-500'}`}>
                    <Star size={14} fill={t.isDefault ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" title="Delete template"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete template "${t.name}"?`)) deleteTpl.mutate(t._id) }}
                    className="p-1 rounded cursor-pointer text-muted-foreground/40 hover:text-destructive">
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
            {newTplOpen ? (
              <form
                onSubmit={(e) => { e.preventDefault(); if (newTplName.trim()) createTpl.mutate(newTplName.trim()) }}
                className="rounded-lg border border-primary/40 bg-primary/5 p-2.5 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">New template</div>
                <Input autoFocus value={newTplName} onChange={(e) => setNewTplName(e.target.value)}
                  placeholder="e.g. Agreement, Expiry Notice" />
                <div className="flex gap-1.5">
                  <Button type="submit" size="sm" disabled={!newTplName.trim() || createTpl.isPending}>
                    {createTpl.isPending ? 'Creating…' : 'Create'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => { setNewTplOpen(false); setNewTplName('') }}>Cancel</Button>
                </div>
              </form>
            ) : (
              <button type="button"
                onClick={() => setNewTplOpen(true)}
                className="w-full rounded-lg border border-dashed px-3 py-2 text-sm text-primary font-semibold hover:bg-primary/5 cursor-pointer flex items-center justify-center gap-1.5">
                <Plus size={14} /> New template
              </button>
            )}
            <p className="text-[10.5px] text-muted-foreground pt-1">
              The <Star size={10} className="inline text-amber-500" fill="currentColor" /> template is used for contract agreement PDFs.
            </p>
          </CardBody>
        </Card>

        {/* Editor */}
        <Card className="flex-1 min-w-0 w-full">
          <CardBody className="pt-4 space-y-3">
            {!selectedId ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Create a template to start.</p>
            ) : (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }}
                    className="max-w-xs font-semibold" placeholder="Template name" />
                  <span className="text-[11px] text-muted-foreground">
                    Paste from Word — tables and formatting are kept and printed in the PDF.
                  </span>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Click to insert a placeholder at the cursor
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(data?.placeholders ?? []).map((p) => (
                      <button key={p} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertPlaceholder(p)}
                        className="px-2 py-1 rounded-md border text-[11px] font-mono text-primary hover:bg-primary/5 cursor-pointer">
                        {`{{${p}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rich editor — contentEditable keeps Word's structure on paste */}
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onInput={() => setDirty(true)}
                  className="agreement-editor w-full rounded-lg border bg-white p-6 text-[13.5px] leading-relaxed outline-none focus:border-primary"
                  style={{ minHeight: 560, maxWidth: 820 }}
                />
                <style>{`
                  .agreement-editor table { border-collapse: collapse; width: 100%; margin: 8px 0; }
                  .agreement-editor td, .agreement-editor th { border: 1px solid #bbb; padding: 5px 8px; font-size: 13px; }
                  .agreement-editor h1 { font-size: 20px; font-weight: 700; margin: 12px 0 6px; }
                  .agreement-editor h2 { font-size: 16px; font-weight: 700; margin: 10px 0 5px; }
                  .agreement-editor h3 { font-size: 14px; font-weight: 700; margin: 8px 0 4px; }
                  .agreement-editor p { margin: 6px 0; }
                  .agreement-editor ul, .agreement-editor ol { padding-left: 22px; margin: 6px 0; }
                `}</style>

                {error && <p className="text-xs text-destructive">{error}</p>}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
