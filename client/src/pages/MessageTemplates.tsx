import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, MessageSquare, RotateCcw, Save } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Button, Card, CardBody, CardHeader, PageHeader, Spinner, Textarea, Field, Input } from '../components/ui'

type Template = {
  _id: string
  key: string
  label: string
  subject: string
  emailBody: string
  whatsappBody: string
  variables: string[]
}

export default function MessageTemplates() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Template | null>(null)
  const [tab, setTab] = useState<'email' | 'whatsapp'>('email')
  const [subject, setSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [whatsappBody, setWhatsappBody] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ['message-templates'],
    queryFn: () => api.get('/message-templates').then(r => r.data),
  })

  const updateMut = useMutation({
    mutationFn: (body: { subject: string; emailBody: string; whatsappBody: string }) =>
      api.put(`/message-templates/${selected!._id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['message-templates'] }); setSuccess('Saved!'); setError(''); setTimeout(() => setSuccess(''), 2000) },
    onError: (e) => setError(apiError(e)),
  })

  const resetMut = useMutation({
    mutationFn: (key: string) => api.post(`/message-templates/${key}/reset`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['message-templates'] })
      const t = res.data as Template
      setSubject(t.subject); setEmailBody(t.emailBody); setWhatsappBody(t.whatsappBody)
      setSuccess('Reset to default'); setTimeout(() => setSuccess(''), 2000)
    },
    onError: (e) => setError(apiError(e)),
  })

  function selectTemplate(t: Template) {
    setSelected(t)
    setSubject(t.subject)
    setEmailBody(t.emailBody)
    setWhatsappBody(t.whatsappBody)
    setError(''); setSuccess('')
  }

  if (isLoading) return <Spinner />

  return (
    <div>
      <PageHeader title="Message Templates" subtitle="Edit email and WhatsApp templates for automated messages" />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        {/* Template list */}
        <div className="space-y-1.5">
          {templates.map(t => (
            <button key={t._id} onClick={() => selectTemplate(t)}
              className={`w-full text-left rounded-lg border px-4 py-3 transition-colors cursor-pointer ${selected?._id === t._id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
              <div className="font-medium text-sm">{t.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Key: {t.key}</div>
            </button>
          ))}
        </div>

        {/* Editor */}
        {selected ? (
          <Card>
            <CardHeader title={selected.label} subtitle={`Template: ${selected.key}`}
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => resetMut.mutate(selected.key)} disabled={resetMut.isPending}>
                    <RotateCcw size={13} /> Reset
                  </Button>
                  <Button size="sm" onClick={() => updateMut.mutate({ subject, emailBody, whatsappBody })} disabled={updateMut.isPending}>
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
                  <Field label="WhatsApp Message">
                    <Textarea value={whatsappBody} onChange={e => setWhatsappBody(e.target.value)} rows={10} className="font-mono text-sm" placeholder="WhatsApp message..." />
                  </Field>
                  <p className="text-xs text-muted-foreground">Use *text* for bold in WhatsApp.</p>
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
    </div>
  )
}
