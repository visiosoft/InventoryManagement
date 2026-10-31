import { test, expect, type Page } from '@playwright/test'
import PB from './fixtures/playbook.json' with { type: 'json' }

/* The sales sandbox, scenario library, suite gates, blind review and
   playbook settings, against a mocked API. The playbook fixture is the real
   self-storage template, generated from the server's own code. */

const SHOT = process.env.SHOT_DIR
const ORG = { id: 'o1', name: 'PurpleBox Storage', slug: 'purplebox', business: 'self-storage in Dubai', categories: ['Other'], prohibited: [], activeSnapshot: 2, plan: 'pilot', maxReplyLength: 700, retentionDays: 365, facts: '', variables: [], ai: { provider: '', model: '', keyHint: '', defaults: { anthropic: 'claude-opus-5-5', openai: 'gpt-4o-mini' } }, connector: { url: '', enabled: false, hasToken: false, lastCheck: '' }, whatsapp: { connected: false, phoneNumberId: '' } }
const USER = { id: 'u1', email: 'mase@purplebox.example', name: 'Mase', platformAdmin: false, orgs: [{ id: 'o1', name: 'PurpleBox Storage', slug: 'purplebox', role: 'owner' }] }

const TURN = {
  state: 'recommendation', nba: 'recommend_size', reply: 'For a studio with a bed, sofa and fridge I’d start with about 50 sq ft — enough room without paying for space you won’t use. Want to see what 50 sq ft looks like?',
  lead: { customer_type: { value: 'Personal', confidence: 0.9 }, use_case: { value: 'Moving', confidence: 0.85 }, items: { value: 'Studio furniture + boxes', confidence: 0.8 }, estimated_size: { value: '50 sq ft', confidence: 0.7 } },
  media: ['unit_medium'], actions: [], needsHuman: false, reason: 'Items are known, so a size can be recommended.', latencyMs: 2300, agent: 'Playbook agent', model: 'anthropic:claude-opus-5-5', promptVersion: PB.promptVersion, knowledgeVersion: 2,
  trace: { answers: [{ id: 'k1', question: 'What size do I need for a studio?', answer: '…', score: 0.71 }], facts: ['Medium units: 50 / 75 sq ft for furniture'], tools: [], media: [{ key: 'unit_medium', label: 'Medium unit video (50–75 sq ft)' }] },
}
const GRADE = { scores: { accuracy: 100, understanding: 95, recommendation: 92, progression: 90, value: 70, objection: 100, tone: 95, cta: 85 }, score: 92.2, autoFails: [], nbaOk: true, escalationOk: true, factualOk: true, completed: null, pass: true, note: 'Clear recommendation with a reason; value could name temperature control for furniture.', unsupportedFigures: [] }
const S = (id: string, group: string, title: string, message: string, extra = {}) => ({ _id: id, group, title, message, context: [], leadBefore: {}, intent: title, nba: ['give_price'], idealResponse: '', media: [], badResponse: '', critique: '', outcome: '', commercial: '', mustEscalate: false, factual: false, core: true, source: 'seed', status: 'draft', ...extra })
const SCEN = [
  S('s1', 'pricing', 'Exact size price', 'What is the price for a 50 sq ft unit?', { factual: true, status: 'approved', idealResponse: 'Our 50 sq ft unit is AED 520 per 4 weeks…' }),
  S('s2', 'objections', 'Too expensive', 'That’s too expensive', { nba: ['handle_objection', 'ask_discovery'] }),
  S('s3', 'escalation', 'Complaint', 'My unit was left open and I’m very upset', { nba: ['escalate'], mustEscalate: true, outcome: 'escalation' }),
]
const COV = PB.playbook.groups.map((g, i) => ({ ...g, approved: [8, 4, 3, 10, 6, 9, 2, 1, 4, 7][i] ?? 0, draft: [2, 8, 7, 2, 6, 11, 6, 7, 6, 3][i] ?? 0 }))
const GATES = [
  { key: 'core', label: 'Core scenarios pass', target: '≥ 95%', actual: 88.9, status: 'fail' },
  { key: 'factual', label: 'Factual accuracy (price, availability, policy, promotion)', target: '100%', actual: 100, status: 'pass' },
  { key: 'autoFails', label: 'Automatic fails', target: '≤ 0', actual: 1, status: 'fail' },
  { key: 'avgScore', label: 'Average weighted score', target: '≥ 90', actual: 87.4, status: 'fail' },
  { key: 'blind', label: 'Blind review: send as-is or minor edit', target: '≥ 90% of 20+', actual: 92, status: 'pending', note: '12 rated' },
  { key: 'completion', label: 'Reaches the right outcome', target: '≥ 90%', actual: 93.3, status: 'pass' },
  { key: 'escalation', label: 'Mandatory escalations handed over', target: '100%', actual: 100, status: 'pass' },
  { key: 'stability', label: 'No regression since the last run', target: '0 newly failing, drop ≤ 2', actual: 1, status: 'fail', note: '1 newly failing, score +3.1' },
]
const RUN = { _id: 'r1', label: 'Core suite · 54 scenarios', scope: 'core', agent: 'Playbook agent', model: 'anthropic:claude-opus-5-5', promptVersion: PB.promptVersion, knowledgeVersion: 2, status: 'done', progress: { done: 54, total: 54 }, gates: GATES, regressions: ['s2'], passedAll: false, createdAt: '2026-10-29T10:00:00Z',
  summary: { cases: 54, completed: 54, errors: 0, passed: 48, passPct: 88.9, corePct: 88.9, factualPct: 100, escalationPct: 100, completionPct: 93.3, autoFails: 1, avgScore: 87.4, nbaPct: 90.7, blindRated: 12, blindOkPct: 92 } }

async function setup(page: Page) {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname; const method = req.method()
    if (method !== 'GET') calls.push({ method, path, body: JSON.parse(req.postData() || '{}') })
    if (path === '/api/auth/me') return route.fulfill({ json: { user: USER } })
    if (path === '/api/org') return route.fulfill({ json: { org: ORG, role: 'owner', permissions: ['import', 'review', 'approve', 'publish', 'evaluate', 'manage'] } })
    if (path === '/api/training/overview') return route.fulfill({ json: { questions: 412, review: { approved: 3 }, knowledge: { published: 4 }, activeSnapshot: 2, evals: [{}], trend: [], activity: [], queue: [], top: [], testTrend: [] } })
    if (path === '/api/sales/playbook' && method === 'GET') return route.fulfill({ json: PB })
    if (path === '/api/sales/playbook') return route.fulfill({ json: { playbook: PB.playbook, promptVersion: 'abcd1234' } })
    if (path === '/api/sales/scenarios' && method === 'GET') return route.fulfill({ json: { scenarios: SCEN, coverage: COV } })
    const one = /^\/api\/sales\/scenarios\/(s\d)$/.exec(path)
    if (one && method === 'GET') return route.fulfill({ json: { scenario: SCEN.find((s) => s._id === one[1]) } })
    if (/\/scenarios\/s\d\/draft$/.test(path)) return route.fulfill({ json: { idealResponse: 'I understand — budget matters. Is it the total cost, or are you comparing a quote from somewhere else?', nba: 'handle_objection', media: [] } })
    if (path === '/api/sales/sandbox/turn') return route.fulfill({ json: { id: 't1', session: 'x', out: TURN } })
    if (path === '/api/sales/sandbox/t1/score') return route.fulfill({ json: { grade: GRADE } })
    if (path === '/api/sales/sandbox/t1/save') return route.fulfill({ status: 201, json: { scenario: { _id: 's9' }, corrected: true } })
    if (path === '/api/sales/runs' && method === 'GET') return route.fulfill({ json: { runs: [RUN] } })
    if (path === '/api/sales/runs/r1') return route.fulfill({ json: { run: { ...RUN, cases: [{ scenario: 's2', title: 'Too expensive', group: 'objections', message: 'That’s too expensive', context: [], expected: ['handle_objection'], ideal: '', out: { reply: 'We can offer 10% off today!', nba: 'offer_incentive', state: 'objection', media: [], needsHuman: false, reason: '' }, grade: { ...GRADE, score: 41.5, pass: false, nbaOk: false, autoFails: ['unauthorized_discount'], note: 'Discounted before diagnosing the objection.' } }] } } })
    if (path === '/api/sales/runs/r1/blind' && method === 'GET') return route.fulfill({ json: { remaining: 42, rated: 12, item: { index: 3, context: [], message: 'Can I come at night?', reply: 'Yes — you have 24/7 access with your own code. Would you like to visit first to see the facility?' } } })
    if (path === '/api/sales/runs/r1/blind') return route.fulfill({ json: { summary: RUN.summary, gates: GATES, passedAll: false } })
    if (path === '/api/training/evals') return route.fulfill({ json: { evals: [], comparison: null } })
    if (path === '/api/training/agent') return route.fulfill({ json: { name: 'Hosted agent', connected: false } })
    return route.fulfill({ json: { ok: true } })
  })
  await page.addInitScript(() => { localStorage.setItem('trainer_token', 't'); localStorage.setItem('trainer_org', 'o1') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  return calls
}

test('sandbox: the agent replies with its action, lead state, media and trace; a reply is scored and corrected into a scenario', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/sandbox')
  await page.getByLabel('Customer message').fill('Moving out of a studio, bed, sofa, fridge and some boxes')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(/I’d start with about 50 sq ft/)).toBeVisible()
  await expect(page.getByText('would send Medium unit video (50–75 sq ft)')).toBeVisible()
  await expect(page.getByText('Studio furniture + boxes')).toBeVisible()
  await expect(page.getByText('Items are known, so a size can be recommended.')).toBeVisible()
  await expect(page.getByText('“Medium units: 50 / 75 sq ft for furniture”')).toBeVisible()
  const sent = calls.find((c) => c.path === '/api/sales/sandbox/turn')!.body
  expect(sent).toMatchObject({ message: 'Moving out of a studio, bed, sofa, fridge and some boxes', context: [], agent: 'hosted' })

  await page.getByRole('button', { name: 'Score' }).click()
  await expect(page.getByText('92.2/100')).toBeVisible()
  if (SHOT) await page.screenshot({ path: `${SHOT}/trainer-sandbox.png`, fullPage: true })

  await page.getByRole('button', { name: 'Correct' }).click()
  await page.getByLabel('Ideal reply').fill('For a studio I’d start with 50 sq ft. It’s temperature controlled, so your furniture stays in good shape. Want to see it?')
  await page.getByLabel('Correct next action').selectOption('send_unit_media')
  await page.getByRole('button', { name: 'Save correction' }).click()
  await expect(page.getByText(/the training bot uses it from the next message/)).toBeVisible()
  expect(calls.find((c) => c.path === '/api/sales/sandbox/t1/save')!.body).toMatchObject({ nba: ['send_unit_media'], group: 'pricing' })

  // The next message carries the conversation and the lead state forward.
  await page.getByLabel('Customer message').fill('How much is it?')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect.poll(() => calls.filter((c) => c.path === '/api/sales/sandbox/turn').length).toBe(2)
  const second = calls.filter((c) => c.path === '/api/sales/sandbox/turn')[1].body as { context: unknown[]; lead: Record<string, unknown> }
  expect(second.context).toHaveLength(2)
  expect(second.lead.estimated_size).toMatchObject({ value: '50 sq ft' })
})

test('scenarios: coverage against the matrix, the AI drafts an ideal reply, and approving saves first', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/scenarios')
  await expect(page.getByText(/54 approved of the 112/).first()).toBeVisible()
  await page.getByText('Too expensive').first().click()
  await page.getByRole('button', { name: 'Draft with AI' }).click()
  await expect(page.getByRole('textbox', { name: 'Ideal reply' })).toHaveValue(/Is it the total cost/)
  await page.getByRole('group', { name: 'Correct next action (any of)' }).getByRole('button', { name: 'Ask discovery question' }).click()
  if (SHOT) await page.screenshot({ path: `${SHOT}/trainer-scenarios.png`, fullPage: true })
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByText('Approved — it is now part of the test suite.')).toBeVisible()
  const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/sales/scenarios/s2')!.body
  expect(patch.nba).toEqual(['handle_objection'])
  expect(calls.map((c) => c.path)).toContain('/api/sales/scenarios/s2/approve')
})

test('tests & go-live: gates block the next stage, a failing case shows why, and blind review hides the score', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/tests')
  await expect(page.getByText('Core scenarios pass')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move to B · Human approval' })).toBeDisabled()
  await page.getByRole('button', { name: /^Core suite · 54 scenarios/ }).click()
  await expect(page.getByText('Unauthorised discount')).toBeVisible()
  await expect(page.getByText('Newly failing', { exact: true })).toBeVisible()
  if (SHOT) await page.screenshot({ path: `${SHOT}/trainer-golive.png`, fullPage: true })
  await page.getByRole('button', { name: 'Blind review' }).click()
  await expect(page.getByText(/24\/7 access with your own code/)).toBeVisible()
  await expect(page.getByText('12 rated · 42 left')).toBeVisible()
  await page.getByRole('button', { name: /Minor edit/ }).click()
  await expect.poll(() => calls.find((c) => c.path === '/api/sales/runs/r1/blind')?.body).toEqual({ index: 3, rating: 'minor' })
})

test('playbook settings: the scorecard is editable and saved as a whole', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/settings?tab=playbook')
  await expect(page.getByText('Weights add up to')).toBeVisible()
  await page.getByLabel('Measure Weight 7').fill('10')
  await expect(page.getByText(/add up to\s*105/)).toBeVisible()
  await page.getByRole('button', { name: 'Save playbook' }).click()
  await expect(page.getByText('Saved · playbook version abcd1234')).toBeVisible()
  const saved = calls.find((c) => c.method === 'PUT')!.body as { playbook: { rubric: { key: string; weight: number }[] } }
  expect(saved.playbook.rubric.find((r) => r.key === 'tone')!.weight).toBe(10)
})
