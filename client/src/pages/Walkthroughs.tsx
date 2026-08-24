import { Compass, Play, Check } from 'lucide-react'
import { Card, CardBody, PageHeader } from '../components/ui'
import { useWalkthroughs } from '../walkthroughs/WalkthroughProvider'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

export default function Walkthroughs() {
  const { state, start, setEnabled, available } = useWalkthroughs()
  const completed = state?.completed ?? []
  const enabled = state?.enabled !== false

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Walkthroughs"
        subtitle="Short guided tours of the things that take a few steps to set up"
      />

      <Card>
        <CardBody>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-medium">Show me a walkthrough when there is a new one</span>
              <span className="block text-muted-foreground text-[13px]">
                Turn this off and nothing starts on its own. You can still run any of them from
                the list below whenever you want.
              </span>
            </span>
          </label>
        </CardBody>
      </Card>

      {available.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center">
            <Compass size={28} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm text-muted-foreground">No walkthroughs for your role yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {available.map((w) => {
            const done = completed.includes(w.id)
            return (
              <Card key={w.id}>
                <CardBody className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[14px]" style={{ color: INK }}>{w.title}</span>
                      {done && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                          style={{ background: '#DCFCE7', color: '#047857', fontSize: 10.5, fontWeight: 700 }}
                        >
                          <Check size={10} /> Done
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>{w.summary}</p>
                    <p className="text-[11.5px] mt-1" style={{ color: MUTED }}>{w.steps.length} steps</p>
                  </div>
                  {/* Replaying does not un-complete it: someone checking a
                      detail should not have it start on them again tomorrow. */}
                  <button
                    type="button"
                    onClick={() => start(w.id)}
                    className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-white cursor-pointer hover:opacity-90 shrink-0"
                    style={{ background: PURPLE, fontSize: 13, fontWeight: 700 }}
                  >
                    <Play size={13} /> {done ? 'Run again' : 'Start'}
                  </button>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
