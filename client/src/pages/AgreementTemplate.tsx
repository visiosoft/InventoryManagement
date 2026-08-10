import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import { Button, Card, CardBody, PageHeader, Spinner } from '../components/ui'
import { formatDate } from '../lib/utils'

type TemplateData = { body: string; updatedAt: string | null; updatedBy: string; placeholders: string[] }

/**
 * Design the storage agreement in the app instead of maintaining a PDF file.
 * Placeholders fill from each contract when its PDF is generated; "# " starts
 * a section heading, "## " a sub-heading, blank lines separate paragraphs.
 */
export default function AgreementTemplate() {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const { data, isLoading } = useQuery<TemplateData>({
    queryKey: ['agreement-template'],
    queryFn: () => api.get('/agreement-template').then((r) => r.data),
  })

  useEffect(() => {
    if (data && !dirty) setBody(data.body)
  }, [data, dirty])

  const save = useMutation({
    mutationFn: () => api.put('/agreement-template', { body }),
    onSuccess: () => { setDirty(false); setError(''); qc.invalidateQueries({ queryKey: ['agreement-template'] }) },
    onError: (e) => setError(apiError(e)),
  })

  const insertPlaceholder = (name: string) => {
    const token = `{{${name}}}`
    const el = areaRef.current
    if (!el) { setBody((b) => b + token); setDirty(true); return }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    setDirty(true)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length) })
  }

  if (isLoading) return <Spinner />

  return (
    <div>
      <PageHeader
        title="Agreement Template"
        subtitle={data?.updatedAt ? `Last saved ${formatDate(data.updatedAt)}${data.updatedBy ? ` by ${data.updatedBy}` : ''}` : 'Not saved yet — contracts fall back to the built-in document'}
        action={
          <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
            {save.isPending ? 'Saving…' : dirty ? 'Save template' : 'Saved'}
          </Button>
        }
      />

      <Card>
        <CardBody className="space-y-3">
          <div className="text-xs text-muted-foreground leading-relaxed">
            Every contract PDF is generated from this wording, with the placeholders filled from that
            contract. Start a line with <code className="px-1 rounded bg-muted"># </code> for a section
            heading, <code className="px-1 rounded bg-muted">## </code> for a sub-heading; blank lines
            separate paragraphs. A contract can also carry its own edited copy (Edit Agreement on the
            contract page), which then wins over this template.
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Click to insert a placeholder
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(data?.placeholders ?? []).map((p) => (
                <button key={p} type="button" onClick={() => insertPlaceholder(p)}
                  className="px-2 py-1 rounded-md border text-[11.5px] font-mono text-primary hover:bg-primary/5 cursor-pointer">
                  {`{{${p}}}`}
                </button>
              ))}
            </div>
          </div>

          <textarea
            ref={areaRef}
            value={body}
            onChange={(e) => { setBody(e.target.value); setDirty(true) }}
            spellCheck={false}
            placeholder={'# Storage License Agreement\n\nThis agreement is made on {{todayDate}} between PurpleBox Storage and {{customerName}} ({{customerPhone}}).\n\n## Unit\nUnit(s) {{unitNumbers}} ({{unitSizes}}) from {{startDate}} to {{endDate}}.\n\n## Charges\nRent AED {{leasedPrice}} per 4 weeks. Total AED {{totalQuotation}}.\n\n# Terms & Conditions\n1. ...'}
            className="w-full rounded-lg border p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-primary"
            style={{ minHeight: 520, resize: 'vertical' }}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardBody>
      </Card>
    </div>
  )
}
