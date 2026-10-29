import { test, expect } from '@playwright/test'

/* AI Training review: the keyboard decides, an edit is sent as an edit,
   and the next intent opens after each decision. */

const SHOT = process.env.SHOT_DIR
const ME = { org: { id: 'o1', name: 'PurpleBox Storage', categories: ['Storage pricing', 'Location and hours', 'Complaints', 'Other'], activeSnapshot: 2, business: 'storage', prohibited: [] }, role: 'owner', permissions: ['import', 'review', 'approve', 'publish', 'evaluate', 'manage'] }
const CLUSTERS = [
  { _id: 'c1', key: 'price', name: 'Storage price by size', category: 'Storage pricing', question: 'How much is a 50 sqft unit?', count: 64, languages: ['en'], status: 'suggested', bulkEligible: true,
    suggestion: { text: 'A 50 sqft unit is {price_50} per 4 weeks, and the first month is discounted. How long do you need it for?', sources: ['Live prices from the CRM'], needsData: '', escalate: false, by: 'ai', at: '2026-10-29T08:00:00Z' } },
  { _id: 'c2', key: 'loc', name: 'Location and visiting hours', category: 'Location and hours', question: 'Where are you located?', count: 41, languages: ['en', 'ar'], status: 'suggested', bulkEligible: true,
    suggestion: { text: 'We are at {address}. Map: {map_link}. Visits {opening_hours}.', sources: ['Facility details'], needsData: '', escalate: false } },
  { _id: 'c3', key: 'damage', name: 'Damaged item complaint', category: 'Complaints', question: 'My item was damaged in storage', count: 6, languages: ['en'], status: 'suggested', bulkEligible: false,
    suggestion: { text: 'I am very sorry to hear that…', sources: [], needsData: 'the insurance claim process', escalate: true } },
]
const Q = (id: string, text: string, extra = {}) => ({ _id: id, text, lang: 'en', repeats: 1, split: 'train', ...extra })

async function setup(page: import('@playwright/test').Page) {
  const posts: { path: string; body: Record<string, unknown> }[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname
    if (req.method() === 'POST') posts.push({ path, body: JSON.parse(req.postData() || '{}') })
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/training/me') return route.fulfill({ json: ME })
    if (path === '/api/training/overview') return route.fulfill({ json: { questions: 412, holdout: 81, intents: 37, review: { suggested: 29, approved: 6, escalated: 1, rejected: 1 }, knowledge: { published: 4, approved: 2 }, edited: 3, conflicts: 1, activeSnapshot: 2, snapshots: 2, openFeedback: 0, evals: [{ label: 'Test of 30', createdAt: '2026-10-29T09:00:00Z', summary: { mean: 3.9, checksPassed: 26, completed: 30 } }] } })
    if (path === '/api/training/clusters' && req.method() === 'GET') return route.fulfill({ json: { clusters: CLUSTERS } })
    const m = /^\/api\/training\/clusters\/(c\d)$/.exec(path)
    if (m) {
      const c = CLUSTERS.find((x) => x._id === m[1])!
      return route.fulfill({ json: { cluster: { ...c, comments: [], history: [{ action: 'suggested', by: { name: 'AI' }, at: '2026-10-29T08:00:00Z' }] }, record: null,
        questions: [Q('q1', 'how much for 50 sqft?', { repeats: 9, humanReply: 'Hi! 50 sqft is AED 975 for 4 weeks' }), Q('q2', 'price of medium storage'), Q('q3', 'كم سعر 50 قدم', { lang: 'ar', split: 'eval' })],
        preview: { text: c.suggestion.text.replace('{price_50}', 'AED 975').replace('{address}', 'Warehouse 12, Al Quoz').replace('{map_link}', 'maps.app/x').replace('{opening_hours}', 'Mon–Sat 10–6'), missing: [] } } })
    }
    if (/\/review$/.test(path)) return route.fulfill({ json: { ok: true, version: 1 } })
    return route.fulfill({ json: /sites|tasks|list|conversations|messages/.test(path) ? [] : {} })
  })
  await page.addInitScript(() => { localStorage.setItem('pb_token', 't'); localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] })) })
  await page.setViewportSize({ width: 1400, height: 1000 })
  return posts
}

test('overview shows where training stands', async ({ page }) => {
  await setup(page)
  await page.goto('/training')
  await expect(page.getByText('Questions imported')).toBeVisible()
  await expect(page.getByText('412')).toBeVisible()
  if (SHOT) await page.screenshot({ path: `${SHOT}/training-overview.png` })
})

test('review by keyboard: A approves and moves on, an edit is sent with Ctrl+Enter, X sends to a person', async ({ page }) => {
  const posts = await setup(page)
  await page.goto('/training?tab=review')
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
