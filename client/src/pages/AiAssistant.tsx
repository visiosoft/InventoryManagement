import { useRef, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bot, Save, Play, AlertTriangle, UserCheck, X } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui'

type Config = {
  enabled: boolean
  mode: 'draft' | 'auto'
  systemPrompt: string
  useAvailability: boolean
  autoSummarise: boolean
  sendVideoOnFirstContact: boolean
  replyWithVoice: boolean
  voice: string
  voiceStyle: string
  voiceSpeed: number
  voices?: string[]
  escalateTo: string
  handoverKeywords: string[]
  maxRepliesPerThreadPerDay: number
  defaultPrompt: string
  /** How long the instructions may be, as the server enforces it. */
  promptLimit?: number
  openai: { configured: boolean; model: string }
}

type Assignable = { _id: string; name: string; email: string; role: string }

type TestResult = { reply: string; needsHuman: boolean; reason: string; model?: string; facts?: string }

export default function AiAssistant() {
  /* Hearing a voice before saving it. Sent the unsaved choice, so trying one
     costs nothing and does not have to be committed to first. */
  const [speaking, setSpeaking] = useState(false)
  const voicePlayer = useRef<HTMLAudioElement | null>(null)
  const [voiceErr, setVoiceErr] = useState('')

  function stopVoice() {
    const a = voicePlayer.current
    if (a) { a.pause(); if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src); voicePlayer.current = null }
    setSpeaking(false)
  }

  async function hearVoice() {
    if (speaking) { stopVoice(); return }
    setVoiceErr('')
    setSpeaking(true)
    try {
      const { data } = await api.post('/ai-bot/speak', {
        text: 'Yes, we have fifty square foot units free from next week. They are 950 dirhams for four weeks. Shall I hold one for you?',
        voice: draft?.voice,
        voiceStyle: draft?.voiceStyle,
        voiceSpeed: draft?.voiceSpeed,
      }, { responseType: 'blob' })
      const url = URL.createObjectURL(data as Blob)
      const audio = new Audio(url)
      voicePlayer.current = audio
      const done = () => { URL.revokeObjectURL(url); voicePlayer.current = null; setSpeaking(false) }
      audio.onended = done
      audio.onerror = done
      await audio.play()
    } catch (e) {
      setVoiceErr(apiError(e))
      setSpeaking(false)
    }
  }

  const qc = useQueryClient()
  const [draft, setDraft] = useState<Config | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const { data: config, isLoading } = useQuery<Config>({
    queryKey: ['ai-bot-config'],
    queryFn: () => api.get('/ai-bot/config').then((r) => r.data),
  })

  const { data: people = [] } = useQuery<Assignable[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data ?? []),
  })

  useEffect(() => { if (config && !draft) setDraft(config) }, [config, draft])

  const save = useMutation({
    mutationFn: (body: Partial<Config>) => api.put('/ai-bot/config', body).then((r) => r.data),
    onSuccess: (data: Config) => {
      setDraft(data); setError(''); setSaved('Saved')
      qc.setQueryData(['ai-bot-config'], data)
      setTimeout(() => setSaved(''), 2500)
    },
    onError: (e) => { setError(apiError(e)); setSaved('') },
  })

  const [testText, setTestText] = useState('')
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const test = useMutation({
    mutationFn: () => api.post('/ai-bot/test', { text: testText, systemPrompt: draft?.systemPrompt }).then((r) => r.data),
    onSuccess: (data: TestResult) => { setTestResult(data); setError('') },
    onError: (e) => { setError(apiError(e)); setTestResult(null) },
  })

  if (isLoading || !draft) return <Spinner />

  const set = (patch: Partial<Config>) => setDraft({ ...draft, ...patch })
  const activePeople = people.filter((p) => p.role !== 'staff')

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="AI assistant"
        subtitle="Replies to WhatsApp enquiries on your behalf, and hands over when it cannot help"
      />

      {!draft.openai.configured && (
        <Card>
          <CardBody className="flex items-start gap-2.5 text-sm">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <span>
              No OpenAI key is connected, so the assistant cannot run. Add one under{' '}
              <Link to="/settings" className="font-semibold underline">Settings → Integrations</Link>.
            </span>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Status" subtitle={`Model: ${draft.openai.model}`} />
        <CardBody className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={draft.enabled}
              onChange={(e) => set({ enabled: e.target.checked })} />
            <span className="text-sm">
              <span className="font-medium">Turn the assistant on</span>
              <span className="block text-muted-foreground text-[13px]">
                It considers every inbound WhatsApp message. If a colleague has already replied to
                the customer's latest message, it stands down rather than speaking over them.
              </span>
            </span>
          </label>

          <div className="space-y-2 pt-1">
            <div className="text-sm font-medium">What it does with its reply</div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="radio" className="mt-1" checked={draft.mode === 'draft'}
                onChange={() => set({ mode: 'draft' })} />
              <span className="text-sm">
                <span className="font-medium">Suggest a reply</span>
                <span className="block text-muted-foreground text-[13px]">
                  The suggestion appears above the composer in the WhatsApp console. Nothing is sent
                  until someone clicks Send.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="radio" className="mt-1" checked={draft.mode === 'auto'}
                onChange={() => set({ mode: 'auto' })} />
              <span className="text-sm">
                <span className="font-medium">Send automatically</span>
                <span className="block text-muted-foreground text-[13px]">
                  The customer receives the reply directly, with nobody reading it first. Prices and
                  availability come from live data, but an answer sent this way is still something
                  the business has said.
                </span>
              </span>
            </label>
          </div>

          {draft.mode === 'auto' && draft.enabled && (
            <p className="text-[13px] rounded-lg px-3 py-2.5 bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900">
              Customers will receive AI-written replies with no human in between. Test with the box
              below, and read a few days of suggestions before choosing this.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="How it should speak"
          subtitle="Your instructions. Rules that stop it inventing prices or promising bookings are always applied on top."
        />
        <CardBody className="space-y-3">
          <Textarea rows={12} value={draft.systemPrompt} className="font-mono text-[12.5px]"
            onChange={(e) => set({ systemPrompt: e.target.value })} />
          {/* The length, in plain sight.
              The server used to cut these at 8,000 characters and save the
              stump, so a long prompt came back ending mid-word with nothing
              said about it. It refuses rather than truncates now, and the count
              is here so nobody has to find the ceiling by losing work. */}
          {(() => {
            const limit = draft.promptLimit ?? 40000
            const used = draft.systemPrompt.length
            const over = used > limit
            return (
              <p style={{ fontSize: 11.5, color: over ? '#B91C1C' : 'rgba(20,8,31,.55)', fontVariantNumeric: 'tabular-nums' }}>
                {used.toLocaleString()} of {limit.toLocaleString()} characters
                {over ? ' — too long to save, shorten it' : ''}
              </p>
            )
          })()}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => set({ systemPrompt: draft.defaultPrompt })}>
              Reset to the default wording
            </Button>
          </div>

          <label className="flex items-start gap-3 cursor-pointer pt-1">
            <input type="checkbox" className="mt-1" checked={draft.useAvailability}
              onChange={(e) => set({ useAvailability: e.target.checked })} />
            <span className="text-sm">
              <span className="font-medium">Answer availability questions</span>
              <span className="block text-muted-foreground text-[13px]">
                Reads the real free units for the dates the customer mentions, using the same
                calculation as the booking screens. Off means it talks about sizes and prices only.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer pt-1">
            <input type="checkbox" className="mt-1" checked={draft.replyWithVoice}
              onChange={(e) => set({ replyWithVoice: e.target.checked })} />
            <span className="text-sm">
              <span className="font-medium">Answer a voice note with a voice note</span>
              <span className="block text-muted-foreground text-[13px]">
                Somebody who sends a voice message gets a spoken reply back, in the same language
                they used. Only ever in reply to one — a spoken answer to somebody who typed cannot
                be skimmed, and a price is the thing people most want to read back. The words are
                saved on the message either way, so the thread stays readable and searchable.
                {draft.replyWithVoice && (
                  <span className="block mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                    <span className="block">
                      Voice:{' '}
                      <select
                        value={draft.voice}
                        onChange={(e) => set({ voice: e.target.value })}
                        className="border rounded px-1.5 py-0.5 text-[12.5px]"
                      >
                        {(draft.voices ?? ['coral', 'sage', 'ballad', 'ash', 'verse']).map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                      {' '}
                      <button
                        type="button"
                        onClick={() => hearVoice()}
                        className="underline cursor-pointer"
                        style={{ color: '#4A1FA0' }}
                      >
                        {speaking ? 'stop' : 'hear it'}
                      </button>
                      {voiceErr && <span className="block text-[12px]" style={{ color: '#B91C1C' }}>{voiceErr}</span>}
                      <span className="block text-[12px] mt-0.5">
                        The first few are the newer, more natural voices. <strong>alloy</strong> and{' '}
                        <strong>echo</strong> are the flattest — they are what sounds robotic.
                      </span>
                    </span>

                    <span className="block">
                      Pace:{' '}
                      <input
                        type="range" min={0.8} max={1.5} step={0.05}
                        value={draft.voiceSpeed}
                        onChange={(e) => set({ voiceSpeed: Number(e.target.value) })}
                        style={{ verticalAlign: 'middle', width: 130 }}
                      />
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}> {draft.voiceSpeed.toFixed(2)}×</span>
                      <span className="block text-[12px] mt-0.5">
                        1.00 is the model's own pace, which most people find slow. Around 1.15 reads
                        as ordinary speaking speed; past 1.4 it stops sounding like a person in a
                        hurry and starts sounding wrong.
                      </span>
                    </span>

                    {/* Delivery, not wording. This does more for how human it
                        sounds than the choice of voice does. */}
                    <span className="block">
                      <span className="block font-medium text-[13px]">How it should sound</span>
                      <textarea
                        rows={2}
                        value={draft.voiceStyle}
                        onChange={(e) => set({ voiceStyle: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-[12.5px] mt-0.5"
                        placeholder="Speak warmly and naturally, like a friendly colleague on the phone…"
                      />
                      <span className="block text-[12px]">
                        Describe the delivery — warmth, pace, how conversational. Press “hear it” to
                        try a change before saving it.
                      </span>
                    </span>
                  </span>
                )}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer pt-1">
            <input type="checkbox" className="mt-1" checked={draft.sendVideoOnFirstContact}
              onChange={(e) => set({ sendVideoOnFirstContact: e.target.checked })} />
            <span className="text-sm">
              <span className="font-medium">Send the facility video on a first message</span>
              <span className="block text-muted-foreground text-[13px]">
                The first time somebody writes in, the facility tour goes out straight away — the
                same quick reply a colleague would tap, so there is one piece of wording and one
                file to keep current. Once per number, ever: somebody coming back months later is
                not new, and getting the tour twice reads as a machine.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer pt-1">
            <input type="checkbox" className="mt-1" checked={draft.autoSummarise !== false}
              onChange={(e) => set({ autoSummarise: e.target.checked })} />
            <span className="text-sm">
              <span className="font-medium">Keep inbox summaries up to date</span>
              <span className="block text-muted-foreground text-[13px]">
                Every couple of hours, reads the conversations that moved in the last two days so
                “Hot leads” in the inbox answers about today. It re-reads nothing that has not
                changed, and never looks further back than two days. It only reads — no message is
                ever sent, and nothing is written to a lead.
              </span>
            </span>
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Handover" subtitle="What happens when the assistant cannot answer" />
        <CardBody className="space-y-3">
          <Field label="Escalations go to">
            <Select value={draft.escalateTo} onChange={(e) => set({ escalateTo: e.target.value })}>
              <option value="">Nobody — the assistant cannot be turned on</option>
              {activePeople.map((p) => (
                <option key={p._id} value={p._id}>{p.name || p.email}</option>
              ))}
            </Select>
          </Field>
          <p className="text-[13px] text-muted-foreground">
            They get a high-priority task with the reason and the recent messages, and the assistant
            goes quiet on that conversation until someone resumes it.
          </p>

          <Field label="Hand over immediately if the message contains">
            <Input
              value={draft.handoverKeywords.join(', ')}
              onChange={(e) => set({ handoverKeywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })}
              placeholder="human, agent, manager"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Most replies to one number per day">
              <Input type="number" min={1} max={200} value={draft.maxRepliesPerThreadPerDay}
                onChange={(e) => set({ maxRepliesPerThreadPerDay: Number(e.target.value) })} />
            </Field>
          </div>
        </CardBody>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
          <Save size={14} /> {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-emerald-600 font-medium">{saved}</span>}
      </div>

      <Card>
        <CardHeader
          title="Try it"
          subtitle="Type what a customer might send. Nothing is sent to anyone."
        />
        <CardBody className="space-y-3">
          <Textarea rows={3} value={testText} onChange={(e) => setTestText(e.target.value)}
            placeholder="Do you have a small unit free from 1 March for two months?" />
          <div className="flex items-center gap-2">
            <Button onClick={() => test.mutate()} disabled={!testText.trim() || test.isPending}>
              <Play size={14} /> {test.isPending ? 'Thinking…' : 'See the reply'}
            </Button>
            {testResult && (
              <Button variant="outline" onClick={() => { setTestResult(null); setTestText('') }}>
                <X size={14} /> Clear
              </Button>
            )}
          </div>

          {testResult && (
            <div className="space-y-2.5 pt-1">
              {testResult.needsHuman ? (
                <div className="flex items-start gap-2 text-sm rounded-lg px-3 py-2.5 border border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900">
                  <UserCheck size={15} className="shrink-0 mt-0.5" />
                  <span>
                    <span className="font-semibold">It would hand this over.</span>{' '}
                    {testResult.reason}
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-sm rounded-lg px-3 py-2.5 border border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900">
                  <Bot size={15} className="shrink-0 mt-0.5" />
                  <span className="font-semibold">It would reply itself.</span>
                </div>
              )}

              {testResult.reply && (
                <div className="rounded-xl px-3.5 py-2.5 text-[13.5px] whitespace-pre-wrap"
                  style={{ background: '#D9FDD3', color: '#111B21' }}>
                  {testResult.reply}
                </div>
              )}

              {testResult.facts && (
                <details className="text-[12px] text-muted-foreground">
                  <summary className="cursor-pointer font-medium">What it was allowed to know</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[11.5px]">{testResult.facts}</pre>
                </details>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
