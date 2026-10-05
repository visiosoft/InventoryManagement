import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/ui'
import { AgentNav, C, DISPLAY, Eyebrow, Note, Panel, Pill, Tag } from './ui'

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: 999, background: C.purpleSoft, color: C.purple, fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, display: 'grid', placeItems: 'center' }}>{n}</div>
      <div>
        <div style={{ fontWeight: 700, color: C.ink, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: C.second, lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  )
}

function Choice({ label, tone, children }: { label: string; tone: 'ok' | 'amber' | 'grey' | 'danger'; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <Tag tone={tone}>{label}</Tag>
      <span style={{ fontSize: 13, color: C.second }}>{children}</span>
    </div>
  )
}

export default function AgentGuide() {
  return (
    <div>
      <AgentNav />
      <PageHeader title="How to use the AI agents" subtitle="A walkthrough of every screen, in the order you'll actually use them." />

      <div style={{ display: 'grid', gap: 12 }}>
        <Panel>
          <Eyebrow>1 · First time only</Eyebrow>
          <div style={{ display: 'grid', gap: 12 }}>
            <Step n={1} title="Create the team">
              Open <Link to="/agents/team" style={{ color: C.purple, fontWeight: 700 }}>Team</Link>. If it says "No agents yet," click <b>Add the starter team</b> — one click creates five agents with their jobs and permissions already set:
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <Tag tone="ok">Aisha — first response</Tag>
                <Tag tone="ok">Omar — follow-ups</Tag>
                <Tag tone="ok">Layla — closing</Tag>
                <Tag tone="ok">Nadia — email, on a schedule</Tag>
                <Tag tone="ok">Sam — tenants</Tag>
              </div>
            </Step>
          </div>
        </Panel>

        <Panel>
          <Eyebrow>2 · The Team page — your roster</Eyebrow>
          <p style={{ fontSize: 13.5, color: C.second, marginTop: 0 }}>Each agent is a card: what job it does, which leads it owns, today's numbers, and an on/off switch top-right. Below the cards, two things worth reading once — the <b>routing rules</b> (who gets a brand-new lead first) and <b>who owns which bucket</b> (who a lead gets handed to as it moves along).</p>
          <div style={{ display: 'grid', gap: 6 }}>
            <Choice label="Open →" tone="ok">that agent's own stats, rehearsal and review (see section 6).</Choice>
            <Choice label="Edit" tone="grey">change its instructions, permissions or schedule (see section 5).</Choice>
          </div>
        </Panel>

        <Panel>
          <Eyebrow>3 · "Needs you" — your daily screen</Eyebrow>
          <p style={{ fontSize: 13.5, color: C.second, marginTop: 0 }}>This is where you'll spend most of your time. It's what opens when you click <Link to="/agents" style={{ color: C.purple, fontWeight: 700 }}>AI Agents</Link>.</p>
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <b style={{ color: C.ink, fontSize: 13.5 }}>Drafts to review</b>
              <p style={{ fontSize: 13, color: C.second, margin: '4px 0 6px' }}>A customer wrote in, an agent drafted a reply — you see both side by side.</p>
              <div style={{ display: 'grid', gap: 5 }}>
                <Choice label="Send as [agent]" tone="ok">sends exactly as written.</Choice>
                <Choice label="Edit" tone="amber">change it, then it sends your version.</Choice>
                <Choice label="Dismiss" tone="grey">throws it away — nothing is sent.</Choice>
              </div>
            </div>
            <div>
              <b style={{ color: C.ink, fontSize: 13.5 }}>Handed to you</b>
              <p style={{ fontSize: 13, color: C.second, margin: '4px 0 0' }}>The agent hit something it can't handle (a discount, a tenant's invoice question) and stopped — you see exactly why, plus everything it already knows about that person. <b>Take over</b> to handle it yourself, or <b>Hand back</b> to let the agent continue.</p>
            </div>
            <div>
              <b style={{ color: C.ink, fontSize: 13.5 }}>Follow-ups proposed</b>
              <p style={{ fontSize: 13, color: C.second, margin: '4px 0 0' }}>A lead's gone quiet and a check-in is due — you see which approved template was picked and why. <b>Send</b> or <b>Skip</b>.</p>
            </div>
          </div>
          <Note>More than one agent on duty? A filter row at the top narrows the list to just one.</Note>
        </Panel>

        <Panel>
          <Eyebrow>4 · Pipeline — where everyone stands</Eyebrow>
          <p style={{ fontSize: 13.5, color: C.second, marginTop: 0 }}>
            <Link to="/agents/pipeline" style={{ color: C.purple, fontWeight: 700 }}>Pipeline</Link> shows every lead as a funnel: <Pill bucket="new" /> → <Pill bucket="engaged" /> → <Pill bucket="quoted" /> → <Pill bucket="booking" /> → <Pill bucket="won" />, plus <Pill bucket="quiet" /> <Pill bucket="dormant" /> <Pill bucket="with_person" /> <Pill bucket="lost" /> underneath.
          </p>
          <p style={{ fontSize: 13.5, color: C.second }}>Click any stage to see its leads below. The percentage beside each arrow (e.g. "→ 41%") is how many move to the next stage — that's the number that tells you whether a follow-up cadence is actually working.</p>
        </Panel>

        <Panel>
          <Eyebrow>5 · Opening one lead</Eyebrow>
          <p style={{ fontSize: 13.5, color: C.second, marginTop: 0 }}>Click any lead's name from Needs you or Pipeline. You'll see the WhatsApp conversation on the left; on the right, the <b>lead file</b> (what they need, what's been offered, what's still open) and a plain-English <b>timeline</b> of everything the agent has done, with <b>Revert</b> on anything that can be undone.</p>
          <Note>The "Watch it think" box on that page lets you type a test message and run it against that real lead's history without sending anything — a quick way to check how an agent will answer before it comes up for real.</Note>
        </Panel>

        <Panel>
          <Eyebrow>6 · Editing an agent, or making a new one</Eyebrow>
          <p style={{ fontSize: 13.5, color: C.second, marginTop: 0 }}>Click <b>Edit</b> on any card, or <b>+ New agent</b> from Team. Five steps, in order:</p>
          <div style={{ display: 'grid', gap: 10 }}>
            <Step n={1} title="Identity">Name, colour, which AI model it uses.</Step>
            <Step n={2} title="The job">Written in four plain sections: who it is, how it talks, what it sells, when it hands over to a person.</Step>
            <Step n={3} title="Permissions">Checkboxes grouped by risk — things it can just <i>look up</i> (safe), things it can <i>do</i> (revertible), and anything involving money (not enabled in this version — a person always confirms those).</Step>
            <Step n={4} title="Training">The "watch it think" tester again, for trying out an instruction change before saving it.</Step>
            <Step n={5} title="On duty">Which lead buckets it owns, which phone number/language it answers on, who it hands escalations to, and its daily budget.</Step>
          </div>
        </Panel>

        <Panel>
          <Eyebrow>7 · Checking how an agent is actually performing</Eyebrow>
          <p style={{ fontSize: 13.5, color: C.second, marginTop: 0 }}>On an agent's own page (Team → <b>Open →</b>):</p>
          <div style={{ display: 'grid', gap: 8 }}>
            <div><b style={{ color: C.ink, fontSize: 13.5 }}>Top stats</b> — <span style={{ fontSize: 13, color: C.second }}>people approached, drafts written, what share were sent <i>as written</i> vs edited vs thrown away, and where it hands over most often.</span></div>
            <div><b style={{ color: C.ink, fontSize: 13.5 }}>Rehearse</b> — <span style={{ fontSize: 13, color: C.second }}>replays real past conversations from your WhatsApp history through the agent and shows its answer next to what your actual rep said at the time. Nothing is sent — purely for judging quality.</span></div>
            <div><b style={{ color: C.ink, fontSize: 13.5 }}>Write a review</b> — <span style={{ fontSize: 13, color: C.second }}>the AI reads all of that and writes a performance review: a grade, strengths, weaknesses, and specific instruction changes you can add with one click.</span></div>
          </div>
        </Panel>

        <Panel style={{ borderColor: C.amber }}>
          <Eyebrow tone={C.amber}>8 · Nadia is different — she works on a schedule, not on WhatsApp</Eyebrow>
          <p style={{ fontSize: 13.5, color: C.second, marginTop: 0 }}>She runs once a day (you set the time in her <b>On duty</b> step) against your shared email inbox. Her results show up as a <b>report card</b> at the top of Needs you ("This morning's desk: 14 sorted, 3 drafts, 1 for a person"), plus any email drafts, reviewed the same way as WhatsApp drafts — Send / Edit / Dismiss.</p>
          <Note>Before she can work: Gmail was connected for sending only. Go to Settings → Integrations → Gmail and reconnect it once — you'll see a Google permission screen mention "read your email," which wasn't there before.</Note>
        </Panel>
      </div>
    </div>
  )
}
