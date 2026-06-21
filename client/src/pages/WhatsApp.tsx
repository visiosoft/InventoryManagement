import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, MessageSquare, RefreshCw } from 'lucide-react'
import { whatsappApi, apiError, type WhatsAppConversation, type WhatsAppMsg } from '../lib/api'
import { Button, Card, CardBody, CardHeader, Field, Input, PageHeader } from '../components/ui'
import { cn } from '../lib/utils'

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function SendForm({ prefillTo, onSent }: { prefillTo?: string; onSent: () => void }) {
  const [to, setTo] = useState(prefillTo ?? '')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')

  const send = useMutation({
    mutationFn: () => whatsappApi.send(to.trim(), body.trim()),
    onSuccess: () => { setBody(''); setErr(''); onSent() },
    onError: (e) => setErr(apiError(e)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!to.trim() || !body.trim()) return
    send.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="To (WhatsApp number with country code)">
        <Input
          placeholder="e.g. 971569420950"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          required
        />
      </Field>
      <Field label="Message">
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          rows={3}
          placeholder="Type your message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
      </Field>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={send.isPending || !to.trim() || !body.trim()}>
          <Send size={14} />
          {send.isPending ? 'Sending…' : 'Send Message'}
        </Button>
      </div>
    </form>
  )
}

function MessageBubble({ msg }: { msg: WhatsAppMsg }) {
  const out = msg.direction === 'outbound'
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-2 text-sm shadow-sm',
          out
            ? 'bg-emerald-600 text-white rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm'
        )}
      >
        <p className="whitespace-pre-wrap break-words">{msg.text || <span className="italic opacity-60">[{msg.type}]</span>}</p>
        <p className={cn('text-[10px] mt-1 text-right', out ? 'text-emerald-100' : 'text-muted-foreground')}>
          {formatTime(msg.occurredAt)}
          {out && ` · ${msg.status || 'sent'}`}
        </p>
      </div>
    </div>
  )
}

export default function WhatsApp() {
  const qc = useQueryClient()
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)

  const { data: conversations, isLoading: loadingConvos, refetch: refetchConvos } = useQuery<WhatsAppConversation[]>({
    queryKey: ['wa-conversations'],
    queryFn: () => whatsappApi.conversations(),
    refetchInterval: 15_000,
  })

  const { data: messages, isLoading: loadingMsgs } = useQuery<WhatsAppMsg[]>({
    queryKey: ['wa-messages', selectedPhone],
    queryFn: () => whatsappApi.messages(selectedPhone ?? undefined),
    refetchInterval: 10_000,
    enabled: true,
  })

  function onSent() {
    qc.invalidateQueries({ queryKey: ['wa-messages'] })
    qc.invalidateQueries({ queryKey: ['wa-conversations'] })
  }

  const sorted = [...(messages ?? [])].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  )

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="WhatsApp"
        subtitle="Send messages and view conversation history"
        action={
          <Button variant="outline" size="sm" onClick={() => { refetchConvos(); qc.invalidateQueries({ queryKey: ['wa-messages'] }) }}>
            <RefreshCw size={14} /> Refresh
          </Button>
        }
      />

      {/* Send panel */}
      <Card>
        <CardHeader
          title="Send a message"
          subtitle="Test account — recipient must be added in Meta dashboard"
        />
        <CardBody>
          <SendForm prefillTo={selectedPhone ?? ''} onSent={onSent} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-[220px_1fr] gap-4">
        {/* Conversations sidebar */}
        <Card>
          <CardHeader title="Conversations" />
          {loadingConvos ? (
            <CardBody className="text-sm text-muted-foreground">Loading…</CardBody>
          ) : (conversations ?? []).length === 0 ? (
            <CardBody className="text-xs text-muted-foreground">No conversations yet. Send a message first.</CardBody>
          ) : (
            <div className="divide-y">
              {(conversations ?? []).map((c) => (
                <button
                  key={c.phoneNormalized}
                  onClick={() => setSelectedPhone(c.phoneNormalized === selectedPhone ? null : c.phoneNormalized)}
                  className={cn(
                    'w-full text-left px-4 py-3 text-sm transition-colors hover:bg-muted/50 cursor-pointer',
                    c.phoneNormalized === selectedPhone ? 'bg-muted font-medium' : ''
                  )}
                >
                  <div className="font-medium truncate">{c.phone || `+${c.phoneNormalized}`}</div>
                  <div className="text-xs text-muted-foreground">{c.count} msg · {formatTime(c.lastAt)}</div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Messages panel */}
        <Card>
          <CardHeader
            title={selectedPhone ? `Chat — +${selectedPhone}` : 'All messages'}
            subtitle={selectedPhone ? undefined : 'Click a conversation to filter'}
          />
          {loadingMsgs ? (
            <CardBody className="text-sm text-muted-foreground">Loading…</CardBody>
          ) : sorted.length === 0 ? (
            <CardBody className="text-sm text-muted-foreground flex items-center gap-2">
              <MessageSquare size={16} />
              No messages found.
            </CardBody>
          ) : (
            <div className="px-4 py-3 space-y-2 max-h-[480px] overflow-y-auto">
              {sorted.map((m) => (
                <MessageBubble key={m._id} msg={m} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Webhook setup hint */}
      <Card>
        <CardHeader title="Setup checklist" subtitle="Required before receiving inbound messages" />
        <CardBody className="text-sm space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-emerald-600 font-bold mt-0.5">1.</span>
            <span>Start ngrok: <code className="bg-muted px-1 rounded text-xs">npx ngrok http 5010</code></span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-600 font-bold mt-0.5">2.</span>
            <span>In Meta Dashboard → WhatsApp → Configuration → Webhook, set Callback URL to <code className="bg-muted px-1 rounded text-xs">https://YOUR-NGROK-URL/api/integrations/whatsapp/webhook</code></span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-600 font-bold mt-0.5">3.</span>
            <span>Set Verify Token to match <code className="bg-muted px-1 rounded text-xs">WHATSAPP_VERIFY_TOKEN</code> in your <code className="bg-muted px-1 rounded text-xs">.env</code></span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-600 font-bold mt-0.5">4.</span>
            <span>Subscribe to the <strong>messages</strong> field under Webhook Fields.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-amber-600 font-bold mt-0.5">!</span>
            <span className="text-muted-foreground">Test account limits sending to max 5 registered recipient numbers only.</span>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
