import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, apiError } from '../lib/api'
import { Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Spinner } from '../components/ui'

type Step = { name: string; ok: boolean; detail: string; fix?: string }
type Hit = { at: string; ok: boolean; reason: string; hasSignature: boolean; field: string; messageCount: number; statusCount: number; from: string }
type Result = { steps: Step[]; phoneId: string; tokenHint: string; usingOverride: boolean; hits?: Hit[] }

/**
 * Why WhatsApp will not connect, in one page.
 *
 * The connect form can only report whatever Meta says, and Meta answers both
 * "wrong id" and "your token may not see this object" with the same sentence.
 * This runs the checks in the order that separates them.
 */
export default function WhatsAppDebug() {
  const [token, setToken] = useState('')
  const [phoneId, setPhoneId] = useState('')

  const run = useMutation<Result, unknown, void>({
    mutationFn: () => api
      .post('/whatsapp-debug/diagnostics', {
        accessToken: token.trim() || undefined,
        phoneNumberId: phoneId.trim() || undefined,
      })
      .then((r) => r.data),
  })

  const result = run.data
  const firstFailure = result?.steps.find((s) => !s.ok)

  return (
    <div>
      <PageHeader title="WhatsApp connection debug"
        subtitle="Runs the Meta checks in order, so a bad token and a bad ID stop looking the same" />

      <Card className="mb-4">
        <CardHeader title="What to test"
          subtitle="Leave both blank to test exactly what is saved on the server" />
        <CardBody className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Access token (optional — not saved)">
              <Input type="password" placeholder="Test a token before saving it"
                value={token} onChange={(e) => setToken(e.target.value)} />
            </Field>
            <Field label="Phone number ID (optional)">
              <Input placeholder="e.g. 830995726773662"
                value={phoneId} onChange={(e) => setPhoneId(e.target.value)} />
            </Field>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Anything typed here is used for this one check and never written to the server.
            Nothing is echoed back except a masked hint.
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? 'Checking…' : 'Run checks'}
            </Button>
            <Link to="/settings" className="text-sm text-primary hover:underline">Back to Settings</Link>
          </div>
          {run.isError && <p className="text-sm text-destructive">{apiError(run.error)}</p>}
        </CardBody>
      </Card>

      {run.isPending && <Spinner />}

      {result && (
        <Card>
          <CardHeader
            title="Results"
            subtitle={`${result.usingOverride ? 'Token typed above' : 'Saved token'} ${result.tokenHint} · phone id ${result.phoneId || '(none)'}`}
          />
          <CardBody className="pt-0 space-y-2">
            {firstFailure && (
              <div className="rounded-lg px-3.5 py-2.5 mb-1" style={{ background: '#FEF3C7', color: '#92400E' }}>
                <div className="text-sm font-bold">First thing to fix: {firstFailure.name}</div>
                {firstFailure.fix && <div className="text-[12.5px] mt-0.5">{firstFailure.fix}</div>}
              </div>
            )}
            {result.steps.map((s) => (
              <div key={s.name} className="flex items-start gap-2.5 py-2 border-b last:border-b-0">
                <span className="mt-0.5 shrink-0 text-sm" style={{ color: s.ok ? '#15803D' : '#B91C1C' }}>
                  {s.ok ? '✓' : '✕'}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{s.name}</div>
                  <div className="text-[12.5px] text-muted-foreground break-words">{s.detail}</div>
                  {!s.ok && s.fix && (
                    <div className="text-[12.5px] mt-1" style={{ color: '#92400E' }}>{s.fix}</div>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {result && (
        <Card className="mt-4">
          <CardHeader
            title="Webhook deliveries from Meta"
            subtitle="Every call Meta has made, accepted or rejected — this is how to tell 'not delivering' from 'delivered and refused'"
          />
          <CardBody className="pt-0">
            {!result.hits?.length ? (
              <p className="text-sm text-muted-foreground py-2">
                Nothing recorded. Meta has not called this server since logging was added — reply to your
                WhatsApp number and run the checks again. If it stays empty, the <strong>messages</strong> field
                is not subscribed in Meta → WhatsApp → Configuration → Manage.
              </p>
            ) : (
              <div className="space-y-1">
                {result.hits.map((h, i) => (
                  <div key={`${h.at}-${i}`} className="flex items-start gap-2.5 py-1.5 border-b last:border-b-0 text-[12.5px]">
                    <span className="mt-0.5 shrink-0" style={{ color: h.ok ? '#15803D' : '#B91C1C' }}>
                      {h.ok ? '✓' : '✕'}
                    </span>
                    <span className="shrink-0 text-muted-foreground w-40">
                      {new Date(h.at).toLocaleString('en-GB')}
                    </span>
                    <span className="min-w-0">
                      {h.field || 'unknown field'}
                      {h.messageCount > 0 && ` · ${h.messageCount} message(s)`}
                      {h.statusCount > 0 && ` · ${h.statusCount} status update(s)`}
                      {h.from && ` · from ${h.from}`}
                      {!h.ok && <span style={{ color: '#B91C1C' }}> — {h.reason}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
