import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronDown, ChevronUp, CheckCircle2, Plus, Power, Save, Trash2 } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui'

// ── Types ────────────────────────────────────────────────────────────────
type StepKind = 'buttons' | 'size_list' | 'date_range' | 'text_question' | 'handoff'

type FlowStepOption = { label: string; action: 'next' | 'handoff' }

type FlowStep = {
  kind: StepKind
  prompt: string
  options: FlowStepOption[]
  listButtonLabel: string
  helpOptionLabel: string
  saveField: 'fullName' | 'contactPhone'
  noAvailabilityText: string
  confirmationText: string
}

type FlowTemplate = {
  _id: string
  name: string
  active: boolean
  custom: boolean
  order: number
  handoffText: string
  completionText: string
  steps: FlowStep[]
}

const KIND_LABEL: Record<StepKind, string> = {
  buttons: 'Button choice',
  size_list: 'Size & pricing list (live inventory)',
  date_range: 'Date range + availability (live)',
  text_question: 'Text question',
  handoff: 'Handoff / end',
}

function blankStep(kind: StepKind): FlowStep {
  return {
    kind,
    prompt: '',
    options: kind === 'buttons' ? [{ label: 'Option 1', action: 'next' }, { label: 'Option 2', action: 'handoff' }] : [],
    listButtonLabel: 'Choose',
    helpOptionLabel: kind === 'size_list' ? 'Need Help Choosing' : '',
    saveField: 'fullName',
    noAvailabilityText: '',
    confirmationText: '',
  }
}

export default function WhatsAppFlowTemplates() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [cloneCurrent, setCloneCurrent] = useState(true)

  // Draft — edited locally, only reaches the server on Save. Everything
  // here is wording, so an AutomationRules-style save-per-keystroke would
  // mean a network round trip on every letter typed.
  const [name, setName] = useState('')
  const [handoffText, setHandoffText] = useState('')
  const [completionText, setCompletionText] = useState('')
  const [steps, setSteps] = useState<FlowStep[]>([])
  const [addKind, setAddKind] = useState<StepKind>('text_question')

  const { data: templates = [], isLoading } = useQuery<FlowTemplate[]>({
    queryKey: ['whatsapp-flow-templates'],
    queryFn: () => api.get('/whatsapp-flow-templates').then(r => r.data),
  })

  const selected = templates.find(t => t._id === selectedId) || null

  useEffect(() => {
    if (!selected) {
      if (!selectedId && templates.length) setSelectedId(templates[0]._id)
      return
    }
    setName(selected.name)
    setHandoffText(selected.handoffText)
    setCompletionText(selected.completionText)
    setSteps(selected.steps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?._id])

  const updateMut = useMutation({
    mutationFn: (id: string) => api.put(`/whatsapp-flow-templates/${id}`, { name, handoffText, completionText, steps }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-flow-templates'] })
      setSuccess('Saved')
      setError('')
      setTimeout(() => setSuccess(''), 2000)
    },
    onError: (e) => setError(apiError(e)),
  })

  const createMut = useMutation({
    mutationFn: (body: { name: string; cloneFrom?: string }) => api.post('/whatsapp-flow-templates', body).then(r => r.data as FlowTemplate),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['whatsapp-flow-templates'] })
      setSelectedId(created._id)
      setCreating(false)
      setNewName('')
      setError('')
    },
    onError: (e) => setError(apiError(e)),
  })

  const activateMut = useMutation({
    mutationFn: (id: string) => api.post(`/whatsapp-flow-templates/${id}/activate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['whatsapp-flow-templates'] }); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const deactivateMut = useMutation({
    mutationFn: (id: string) => api.post(`/whatsapp-flow-templates/${id}/deactivate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['whatsapp-flow-templates'] }); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/whatsapp-flow-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-flow-templates'] })
      setSelectedId(null)
      setError('')
    },
    onError: (e) => setError(apiError(e)),
  })

  function handleCreate() {
    if (!newName.trim()) return
    createMut.mutate({ name: newName.trim(), cloneFrom: cloneCurrent && selected ? selected._id : undefined })
  }

  function addStep() {
    setSteps(s => [...s, blankStep(addKind)])
  }
  function removeStep(idx: number) {
    setSteps(s => s.filter((_, i) => i !== idx))
  }
  function moveStep(idx: number, dir: -1 | 1) {
    setSteps(s => {
      const j = idx + dir
      if (j < 0 || j >= s.length) return s
      const copy = [...s]
      ;[copy[idx], copy[j]] = [copy[j], copy[idx]]
      return copy
    })
  }
  function updateStep(idx: number, patch: Partial<FlowStep>) {
    setSteps(s => s.map((st, i) => i === idx ? { ...st, ...patch } : st))
  }
  function updateOption(stepIdx: number, optIdx: number, patch: Partial<FlowStepOption>) {
    setSteps(s => s.map((st, i) => i === stepIdx
      ? { ...st, options: st.options.map((o, j) => j === optIdx ? { ...o, ...patch } : o) }
      : st))
  }
  function addOption(stepIdx: number) {
    setSteps(s => s.map((st, i) => i === stepIdx && st.options.length < 3
      ? { ...st, options: [...st.options, { label: `Option ${st.options.length + 1}`, action: 'next' as const }] }
      : st))
  }
  function removeOption(stepIdx: number, optIdx: number) {
    setSteps(s => s.map((st, i) => i === stepIdx
      ? { ...st, options: st.options.filter((_, j) => j !== optIdx) }
      : st))
  }

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="WhatsApp Flow Templates"
        subtitle="What a fresh WhatsApp conversation is asked, step by step — edit the wording, reorder or add steps, and pick which one is currently live."
      />

      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        {/* List */}
        <div className={`space-y-1.5 ${selected ? 'hidden lg:block' : ''}`}>
          {isLoading && <Spinner />}
          {templates.map(t => (
            <button
              key={t._id}
              onClick={() => setSelectedId(t._id)}
              className={`w-full text-left rounded-lg border px-4 py-3 transition-colors cursor-pointer ${selectedId === t._id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
            >
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm">{t.name}</div>
                {t.active && <Badge tone="green">Active</Badge>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.steps.length} step{t.steps.length === 1 ? '' : 's'}</div>
            </button>
          ))}

          {creating ? (
            <div className="rounded-lg border border-dashed border-primary/40 p-3 space-y-2">
              <Input placeholder="Template name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              {selected && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={cloneCurrent} onChange={(e) => setCloneCurrent(e.target.checked)} />
                  Start from a copy of "{selected.name}"
                </label>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreate} disabled={createMut.isPending || !newName.trim()}>
                  {createMut.isPending ? 'Creating…' : 'Create'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setCreating(false); setNewName('') }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer"
            >
              <Plus size={14} /> New template
            </button>
          )}
        </div>

        {/* Editor */}
        <div className={selected ? '' : 'hidden lg:block'}>
          {selected && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="lg:hidden mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground cursor-pointer"
            >
              <ChevronLeft size={16} /> All templates
            </button>
          )}

          {selected ? (
            <Card>
              <CardHeader
                title={<Input value={name} onChange={(e) => setName(e.target.value)} className="font-medium" />}
                subtitle={success ? <span className="text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 size={13} /> {success}</span> : undefined}
                action={
                  <div className="flex gap-2">
                    {selected.active ? (
                      <Button size="sm" variant="outline" onClick={() => deactivateMut.mutate(selected._id)} disabled={deactivateMut.isPending}>
                        <Power size={13} /> Turn off
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => activateMut.mutate(selected._id)} disabled={activateMut.isPending}>
                        <Power size={13} /> Activate
                      </Button>
                    )}
                    <Button
                      size="sm" variant="destructive"
                      onClick={() => { if (confirm(`Delete template "${selected.name}"?`)) deleteMut.mutate(selected._id) }}
                      disabled={deleteMut.isPending || selected.active}
                      title={selected.active ? 'Turn this off before deleting it' : ''}
                    >
                      <Trash2 size={13} /> Delete
                    </Button>
                    <Button size="sm" onClick={() => updateMut.mutate(selected._id)} disabled={updateMut.isPending}>
                      <Save size={13} /> {updateMut.isPending ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                }
              />
              <CardBody className="space-y-4">
                {!selected.active && (
                  <p className="text-xs text-muted-foreground rounded-lg border border-dashed px-3 py-2">
                    This template is off — a fresh WhatsApp conversation gets the assistant's own reply instead.
                    Only one template can be active at a time.
                  </p>
                )}

                <div className="space-y-3">
                  {steps.map((step, idx) => (
                    <div key={idx} className="rounded-lg border p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-xs font-semibold">{idx + 1}</span>
                          <Badge>{KIND_LABEL[step.kind]}</Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => moveStep(idx, -1)} disabled={idx === 0} title="Move up">
                            <ChevronUp size={14} />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} title="Move down">
                            <ChevronDown size={14} />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => removeStep(idx)} title="Remove step">
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>

                      {step.kind !== 'date_range' ? (
                        <Field label="Prompt">
                          <Textarea rows={2} value={step.prompt} onChange={(e) => updateStep(idx, { prompt: e.target.value })} />
                        </Field>
                      ) : (
                        <Field label="Calendar prompt — shown alongside the date picker">
                          <Textarea rows={2} value={step.prompt} onChange={(e) => updateStep(idx, { prompt: e.target.value })} placeholder="Great, a {size} sqft unit — tap below to pick the dates you need it for." />
                        </Field>
                      )}

                      {step.kind === 'buttons' && (
                        <div className="space-y-2">
                          {step.options.map((opt, optIdx) => (
                            <div key={optIdx} className="flex gap-2 items-center">
                              <Input
                                value={opt.label}
                                onChange={(e) => updateOption(idx, optIdx, { label: e.target.value })}
                                placeholder={`Option ${optIdx + 1}`}
                                className="flex-1"
                              />
                              <Select
                                value={opt.action}
                                onChange={(e) => updateOption(idx, optIdx, { action: e.target.value as 'next' | 'handoff' })}
                                className="w-40"
                              >
                                <option value="next">Continue flow</option>
                                <option value="handoff">Hand off / end</option>
                              </Select>
                              {step.options.length > 2 && (
                                <Button size="icon" variant="ghost" onClick={() => removeOption(idx, optIdx)}><Trash2 size={13} /></Button>
                              )}
                            </div>
                          ))}
                          {step.options.length < 3 && (
                            <Button size="sm" variant="outline" onClick={() => addOption(idx)}><Plus size={13} /> Add option</Button>
                          )}
                        </div>
                      )}

                      {step.kind === 'size_list' && (
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="List button label">
                            <Input value={step.listButtonLabel} onChange={(e) => updateStep(idx, { listButtonLabel: e.target.value })} />
                          </Field>
                          <Field label={'"Need help" row (blank = no such row)'}>
                            <Input value={step.helpOptionLabel} onChange={(e) => updateStep(idx, { helpOptionLabel: e.target.value })} />
                          </Field>
                        </div>
                      )}

                      {step.kind === 'date_range' && (
                        <>
                          <Field label="Confirmation — sent once a real unit is found free for those dates">
                            <Textarea rows={2} value={step.confirmationText} onChange={(e) => updateStep(idx, { confirmationText: e.target.value })} />
                          </Field>
                          <Field label="No availability — sent when nothing is free for those dates">
                            <Textarea rows={2} value={step.noAvailabilityText} onChange={(e) => updateStep(idx, { noAvailabilityText: e.target.value })} />
                          </Field>
                          <p className="text-[11px] text-muted-foreground">
                            Placeholders: <code>{'{unitNumber}'}</code> <code>{'{size}'}</code> <code>{'{price}'}</code> <code>{'{from}'}</code> <code>{'{to}'}</code>
                          </p>
                        </>
                      )}

                      {step.kind === 'text_question' && (
                        <Field label="Save the answer as">
                          <Select value={step.saveField} onChange={(e) => updateStep(idx, { saveField: e.target.value as 'fullName' | 'contactPhone' })}>
                            <option value="fullName">Full name</option>
                            <option value="contactPhone">Phone number</option>
                          </Select>
                        </Field>
                      )}
                    </div>
                  ))}

                  <div className="flex gap-2 items-center rounded-lg border border-dashed p-2">
                    <Select value={addKind} onChange={(e) => setAddKind(e.target.value as StepKind)} className="flex-1">
                      {(Object.keys(KIND_LABEL) as StepKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </Select>
                    <Button size="sm" variant="outline" onClick={addStep}><Plus size={13} /> Add step</Button>
                  </div>
                </div>

                <Field label="Handoff message — sent whenever a step hands off to a person">
                  <Textarea rows={2} value={handoffText} onChange={(e) => setHandoffText(e.target.value)} />
                </Field>
                <Field label="Completion message — sent once the last step finishes">
                  <Textarea rows={2} value={completionText} onChange={(e) => setCompletionText(e.target.value)} />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Placeholders: <code>{'{name}'}</code> <code>{'{unitNumber}'}</code> <code>{'{size}'}</code> <code>{'{price}'}</code> <code>{'{from}'}</code> <code>{'{to}'}</code>
                  </p>
                </Field>
              </CardBody>
            </Card>
          ) : (
            !isLoading && <p className="text-sm text-muted-foreground">No template selected.</p>
          )}
        </div>
      </div>
    </div>
  )
}
