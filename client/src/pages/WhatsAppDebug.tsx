import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, apiError } from '../lib/api'
import { Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Spinner } from '../components/ui'

type Step = { name: string; ok: boolean; detail: string; fix?: string }
type Result = { steps: Step[]; phoneId: string; tokenHint: string; usingOverride: boolean }

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
    </div>
  )
}
