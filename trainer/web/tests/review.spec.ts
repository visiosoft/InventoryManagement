import { test, expect } from '@playwright/test'

/* The AI Training Center: signing up, switching between customer
   organisations, and reviewing by keyboard (an edit is sent as an edit, the
   next question opens after each decision). */

const SHOT = process.env.SHOT_DIR
const ORG = (id: string, name: string) => ({ id, name, slug: id, business: 'storage', categories: ['Storage pricing', 'Location and hours', 'Complaints', 'Other'], prohibited: [], activeSnapshot: 2, plan: 'pilot', maxReplyLength: 700, retentionDays: 365, facts: '', variables: [], ai: { provider: '', model: '', keyHint: '', defaults: { anthropic: 'claude-opus-5-5', openai: 'gpt-4o-mini' } }, connector: { url: '', enabled: false, hasToken: false, lastCheck: '' }, whatsapp: { connected: false, phoneNumberId: '' } })
const USER = { id: 'u1', email: 'mase@purplebox.example', name: 'Mase', platformAdmin: true, orgs: [{ id: 'o1', name: 'PurpleBox Storage', slug: 'purplebox', role: 'owner' }, { id: 'o2', name: 'Acme Moving', slug: 'acme', role: 'owner' }] }
const PERMS = ['import', 'review', 'approve', 'publish', 'evaluate', 'manage']
const CLUSTERS = [
  { _id: 'c1', key: 'price', name: 'Storage price by size', category: 'Storage pricing', question: 'How much is a 50 sqft unit?', count: 64, languages: ['en'], status: 'suggested', bulkEligible: true,
    suggestion: { text: 'A 50 sqft unit is {price_50} per 4 weeks, and the first month is discounted. How long do you need it for?', sources: ['Live prices from the CRM'], needsData: '', escalate: false, by: 'ai', at: '2026-10-29T08:00:00Z' } },
  { _id: 'c2', key: 'loc', name: 'Location and visiting hours', category: 'Location and hours', question: 'Where are you located?', count: 41, languages: ['en', 'ar'], status: 'suggested', bulkEligible: true,
    suggestion: { text: 'We are at {address}. Map: {map_link}. Visits {opening_hours}.', sources: ['Facility details'], needsData: '', escalate: false } },
  { _id: 'c3', key: 'damage', name: 'Damaged item complaint', category: 'Complaints', question: 'My item was damaged in storage', count: 6, languages: ['en'], status: 'suggested', bulkEligible: false,
    suggestion: { text: 'I am very sorry to hear that…', sources: [], needsData: 'the insurance claim process', escalate: true } },
]
const TREND = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10)
  const w = Math.sin(i / 3.2) + 1.4
  return { day: d, questions: Math.round(18 + 12 * w), approved: Math.round(3 + 4 * w + (i > 20 ? 4 : 0)), edited: Math.round(1 + 2.2 * w), rejected: Math.round(0.6 * w), escalated: i % 4 === 0 ? 1 : 0 }
})
const Q = (id: string, text: string, extra = {}) => ({ _id: id, text, lang: 'en', repeats: 1, split: 'train', ...extra })

async function setup(page: import('@playwright/test').Page, { signedIn = true } = {}) {
  const posts: { path: string; body: Record<string, unknown>; org?: string }[] = []
  const orgHeaders: string[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname
    const org = req.headers()['x-org']
    if (org) orgHeaders.push(org)
    if (req.method() === 'POST') posts.push({ path, body: JSON.parse(req.postData() || '{}'), org })
    if (path === '/api/auth/signup') return route.fulfill({ status: 201, json: { token: 't', user: { ...USER, orgs: [{ id: 'o3', name: 'New Co', slug: 'new-co', role: 'owner' }] } } })
    if (path === '/api/auth/me') return route.fulfill({ json: { user: USER } })
    if (path === '/api/org') return route.fulfill({ json: { org: ORG(org || 'o1', org === 'o2' ? 'Acme Moving' : org === 'o3' ? 'New Co' : 'PurpleBox Storage'), role: 'owner', permissions: PERMS } })
    if (path === '/api/training/overview') return route.fulfill({ json: { questions: org === 'o2' ? 17 : 412, holdout: 81, intents: 37, review: { suggested: 29, approved: 6, escalated: 1, rejected: 1 }, knowledge: { published: 4, approved: 2 }, edited: 3, conflicts: 1, activeSnapshot: 2, snapshots: 2, openFeedback: 0, evals: [{ label: 'Test of 30', createdAt: '2026-10-29T09:00:00Z', summary: { mean: 3.9, checksPassed: 26, completed: 30 } }],
      trend: TREND, testTrend: [{ at: '2026-10-20', mean: 3.1 }, { at: '2026-10-24', mean: 3.5 }, { at: '2026-10-29', mean: 3.9 }],
      activity: [
        { _id: 'a1', action: 'review.approve', by: { name: 'Sara' }, at: new Date(Date.now() - 4 * 60000).toISOString() },
        { _id: 'a2', action: 'review.edit', by: { name: 'Mase' }, at: new Date(Date.now() - 22 * 60000).toISOString() },
        { _id: 'a3', action: 'publish', by: { name: 'Mase' }, at: new Date(Date.now() - 2 * 3600000).toISOString() },
        { _id: 'a4', action: 'review.escalate', by: { name: 'Sara' }, at: new Date(Date.now() - 3 * 3600000).toISOString() },
        { _id: 'a5', action: 'import.start', by: { name: 'Mase' }, at: new Date(Date.now() - 26 * 3600000).toISOString() },
      ],
      queue: CLUSTERS.map((c) => ({ ...c, createdAt: '2026-10-28T08:00:00Z' })),
      top: CLUSTERS.map((c) => ({ _id: c._id, name: c.name, count: c.count, status: c.status, category: c.category })) } })
    if (path === '/api/training/clusters' && req.method() === 'GET') return route.fulfill({ json: { clusters: CLUSTERS } })
    const m = /^\/api\/training\/clusters\/(c\d)$/.exec(path)
    if (m) {
      const c = CLUSTERS.find((x) => x._id === m[1])!
      return route.fulfill({ json: { cluster: { ...c, comments: [], history: [{ action: 'suggested', by: { name: 'AI' }, at: '2026-10-29T08:00:00Z' }] }, record: null,
        questions: [Q('q1', 'how much for 50 sqft?', { repeats: 9, humanReply: 'Hi! 50 sqft is AED 975 for 4 weeks' }), Q('q2', 'price of medium storage'), Q('q3', 'كم سعر 50 قدم', { lang: 'ar', split: 'eval' })],
        preview: { text: c.suggestion.text.replace('{price_50}', 'AED 975').replace('{address}', 'Warehouse 12, Al Quoz').replace('{map_link}', 'maps.app/x').replace('{opening_hours}', 'Mon–Sat 10–6'), missing: [] } } })
    }
    if (/\/review$/.test(path)) return route.fulfill({ json: { ok: true, version: 1 } })
    return route.fulfill({ json: {} })
  })
  if (signedIn) await page.addInitScript(() => { localStorage.setItem('trainer_token', 't') })
  await page.setViewportSize({ width: 1400, height: 1000 })
  return { posts, orgHeaders }
}

test('sign up creates an account and opens its own organisation', async ({ page }) => {
  const { posts } = await setup(page, { signedIn: false })
  await page.goto('/signup')
  await page.getByLabel('Your name').fill('Sara')
  await page.getByLabel('Work email').fill('sara@newco.example')
  await page.getByLabel(/Password/).fill('a-good-password-1')
  await page.getByLabel(/Organisation/).fill('New Co')
  if (SHOT) await page.screenshot({ path: `${SHOT}/trainer-signup.png` })
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect.poll(() => posts.find((p) => p.path === '/api/auth/signup')?.body).toMatchObject({ email: 'sara@newco.example', orgName: 'New Co' })
  await expect(page.getByText("Here's how New Co's AI training is going today.")).toBeVisible()
})

test('each customer is its own organisation: switching changes what every request is for', async ({ page }) => {
  const { orgHeaders } = await setup(page)
  await page.goto('/')
  await expect(page.getByText('412')).toBeVisible()
  await page.getByLabel('Organisation', { exact: true }).selectOption('o2')
  await expect(page.getByText("Here's how Acme Moving's AI training is going today.")).toBeVisible()
  await expect(page.getByText('17', { exact: true })).toBeVisible()
  expect(orgHeaders.at(-1)).toBe('o2')
})

test('overview shows where training stands', async ({ page }) => {
  await setup(page)
  await page.goto('/')
  await expect(page.getByText('Questions imported')).toBeVisible()
  await expect(page.getByText('412')).toBeVisible()
  if (SHOT) await page.screenshot({ path: `${SHOT}/training-overview.png` })
})

test('review by keyboard: A approves and moves on, an edit is sent with Ctrl+Enter, X sends to a person', async ({ page }) => {
  const { posts } = await setup(page)
  await page.goto('/review')
  await expect(page.getByLabel('Answer')).toHaveValue(/A 50 sqft unit is \{price_50\}/)
  await expect(page.getByText(/With today's values: A 50 sqft unit is AED 975/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Approve 2 low-risk/ })).toBeVisible()
  if (SHOT) await page.screenshot({ path: `${SHOT}/training-review.png` })
  await page.keyboard.press('a')
  await expect.poll(() => posts.find((p) => p.path === '/api/training/clusters/c1/review')?.body.action).toBe('approve')
  // The next one opens; edit it and save with Ctrl+Enter.
  await expect(page.getByLabel('Answer')).toHaveValue(/We are at \{address\}/)
  await page.getByLabel('Answer').fill('We are at {address}, near Al Quoz Mall. Map: {map_link}')
  await page.keyboard.press('Control+Enter')
  await expect.poll(() => posts.find((p) => p.path === '/api/training/clusters/c2/review')?.body).toMatchObject({ action: 'edit', text: 'We are at {address}, near Al Quoz Mall. Map: {map_link}' })
  await expect(page.getByText(/Missing information: the insurance claim process/)).toBeVisible()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('x')
  await expect.poll(() => posts.find((p) => p.path === '/api/training/clusters/c3/review')?.body.action).toBe('escalate')
})
