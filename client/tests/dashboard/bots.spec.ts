import { test, expect } from '@playwright/test'

/* Bots on the dashboard: pinned ones on Overview, the Bots tab, reviewing
   and sending a renewal run, and making a new bot. */

const RUN = {
  _id: 'r1', createdAt: '2026-10-26T05:01:00Z', status: 'waiting', summary: '2 to approve', answer: '', sources: [], error: '',
  items: [
    { _id: 'i1', name: 'Sara Ahmed', email: 'sara@example.com', unit: 'B-214', endDate: '2026-11-18T00:00:00Z', subject: 'Your PurpleBox storage ends on 18 November 2026', body: 'Hi Sara,\n\nYour storage unit B-214…', status: 'pending' },
    { _id: 'i2', name: 'Omar Khalid', email: 'omar@example.com', unit: 'A-031', endDate: '2026-11-21T00:00:00Z', subject: 'Ends', body: 'Hi Omar', status: 'pending' },
  ],
}
const CHATS: unknown[] = []
const QUIET_RUN = {
  _id: 'r3', createdAt: '2026-10-28T07:00:00Z', status: 'waiting', summary: '1 to approve', answer: '', sources: [], error: '',
  items: [{ _id: 'w1', channel: 'whatsapp', name: 'Sara Ahmed', phone: '+971501234567', reason: 'Quotation sent · quiet 4 days', email: '', unit: '', endDate: '', subject: '', body: 'Hi Sara, still looking for storage?', status: 'pending' }],
}
const BOTS: Array<Record<string, unknown> & { _id: string; lastRun: unknown; runningSince?: string }> = [
  { _id: 'b1', name: 'Renewal reminder emails', kind: 'contract_emails', icon: '✉️', instruction: '', web: false, days: 30, subject: '', message: '', sendMode: 'review', dailyCap: 50, schedule: { cadence: 'weekly', hour: 9, dayOfWeek: 1, dayOfMonth: 1 }, showOnDashboard: true, enabled: true, scheduleLabel: 'Every Monday 09:00', lastRun: RUN },
  { _id: 'b2', name: 'Competitor watch', kind: 'ai_report', icon: '🔎', instruction: 'prices', web: true, days: 30, subject: '', message: '', sendMode: 'review', dailyCap: 50, schedule: { cadence: 'daily', hour: 8, dayOfWeek: 1, dayOfMonth: 1 }, showOnDashboard: false, enabled: true, scheduleLabel: 'Daily 08:00',
    lastRun: { _id: 'r2', createdAt: '2026-10-26T04:02:00Z', status: 'ok', summary: '', answer: 'Competitor A charges **AED 1,200** for 50 sq ft.', sources: [{ label: 'Competitor A', url: 'https://a.example' }], items: [], error: '' } },
  { _id: 'b3', name: 'Quiet good leads', kind: 'quiet_leads', icon: '💬', instruction: '', web: false, days: 30, subject: '', message: '', quietDays: 3, maxQuietDays: 30, templateName: 'checking_in', templateLanguage: 'en', sendMode: 'review', dailyCap: 30, schedule: { cadence: 'daily', hour: 11, dayOfWeek: 1, dayOfMonth: 1 }, showOnDashboard: false, enabled: true, scheduleLabel: 'Daily 11:00', lastRun: QUIET_RUN },
]

async function setup(page: import('@playwright/test').Page) {
  const calls: { method: string; path: string; body: unknown }[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path.startsWith('/api/bots')) calls.push({ method: req.method(), path, body: req.postData() ? JSON.parse(req.postData()!) : null })
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/bots' && req.method() === 'GET') return route.fulfill({ json: { bots: BOTS, defaults: { subject: 'Your PurpleBox storage ends on {endDate}', message: 'Hi {name}, …' }, recommendedMissing: ['Morning summary', 'Money check'] } })
    if (path === '/api/bots/recommended') return route.fulfill({ status: 201, json: { added: ['Morning summary', 'Money check'] } })
    if (path === '/api/bots' && req.method() === 'POST') return route.fulfill({ status: 201, json: { bot: {} } })
    if (path === '/api/bots/runs/r1/send') return route.fulfill({ json: { sent: 1, run: { ...RUN, items: [{ ...RUN.items[0], status: 'sent' }, RUN.items[1]] } } })
    if (path === '/api/bots/runs/r1/skip') return route.fulfill({ json: { run: RUN } })
    if (path === '/api/bots/b2/run') return route.fulfill({ status: 202, json: { running: true } })
    if (path === '/api/bots/b2/ask') { const body = JSON.parse(req.postData() || '{}'); BOTS[1].lastRun = { _id: 'c1', createdAt: new Date().toISOString(), trigger: 'chat', question: body.question, status: 'ok', summary: '', answer: 'Done — Competitor watch now runs daily 20:00.', sources: [], items: [], error: '' }; CHATS.push(BOTS[1].lastRun); return route.fulfill({ json: { run: BOTS[1].lastRun } }) }
    if (path === '/api/bots/b2/runs' && CHATS.length) return route.fulfill({ json: { runs: [...CHATS].reverse() } })
    const runsOf = /^\/api\/bots\/(b\d)\/runs$/.exec(path)
    if (runsOf) return route.fulfill({ json: { runs: BOTS.filter((b) => b._id === runsOf[1]).map((b) => b.lastRun) } })
    if (path === '/api/bots/b2' && req.method() === 'DELETE') return route.fulfill({ json: { ok: true } })
    if (path === '/api/bots/runs/r3/send') return route.fulfill({ json: { sent: 1, run: { ...QUIET_RUN, items: [{ ...QUIET_RUN.items[0], status: 'sent' }] } } })
    if (path === '/api/assistant/capabilities') return route.fulfill({ json: { enabled: false, allowed: false } })
    if (path === '/api/reports/stats') return route.fulfill({ status: 500, json: {} })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages/.test(path) ? [] : { items: [], total: 0, groups: [], reps: [], handovers: [], byFloor: [] } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  return calls
}

test('an admin lands on the bots; the company dashboard is under Dashboard', async ({ page }) => {
  await setup(page)
  await page.goto('/')
  const watch = page.getByLabel('Bot Competitor watch')
  await expect(watch.getByText('AED 1,200')).toBeVisible()
  await expect(watch.getByRole('link', { name: /Competitor A/ })).toHaveAttribute('href', 'https://a.example')
  await expect(page.getByLabel('Bot Renewal reminder emails').getByText('2 to approve')).toBeVisible()
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByLabel('Bot Renewal reminder emails')).toHaveCount(0)
})

test('reviewing a run: untick one, send the rest, the other is left out', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/bots')
  await page.getByRole('button', { name: 'Review & send 2' }).click()
  await expect(page.getByText('Your storage unit B-214')).toBeVisible()
  await page.getByLabel('Send to Omar Khalid').uncheck()
  await page.getByRole('button', { name: 'Send 1 email' }).click()
  await expect(page.getByText('1 sent.')).toBeVisible()
  expect(calls.find((c) => c.path.endsWith('/send'))?.body).toEqual({ ids: ['i1'] })
  expect(calls.find((c) => c.path.endsWith('/skip'))?.body).toEqual({ ids: ['i2'] })
})

test('a new renewal bot starts from the preset and asks first', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/bots')
  await page.getByRole('button', { name: 'New bot' }).click()
  await page.getByRole('button', { name: /Renewal reminder emails/ }).click()
  await expect(page.getByLabel('Subject')).toHaveValue('Your PurpleBox storage ends on {endDate}')
  await page.getByRole('button', { name: 'Save bot' }).click()
  await expect.poll(() => calls.filter((c) => c.method === 'POST' && c.path === '/api/bots').length).toBe(1)
  const body = calls.find((c) => c.method === 'POST' && c.path === '/api/bots')!.body as Record<string, unknown>
  expect(body).toMatchObject({ name: 'Renewal reminder emails', kind: 'contract_emails', sendMode: 'review', days: 30, schedule: { cadence: 'weekly', hour: 9, dayOfWeek: 1 } })
})

test('the recommended bots are one click away', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/bots')
  await page.getByRole('button', { name: 'Add recommended bots (2)' }).click()
  await expect.poll(() => calls.filter((c) => c.path === '/api/bots/recommended' && c.method === 'POST').length).toBe(1)
})

test('a bot can be deleted from its card, after a confirm', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/bots')
  page.once('dialog', (d) => d.accept())
  await page.getByLabel('Bot Competitor watch').getByRole('button', { name: 'Delete' }).click()
  await expect.poll(() => calls.filter((c) => c.method === 'DELETE' && c.path === '/api/bots/b2').length).toBe(1)
})

test('quiet good leads: the WhatsApp messages are read and sent from the review', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/bots')
  const card = page.getByLabel('Bot Quiet good leads')
  await expect(card.getByText('Quotation sent · quiet 4 days')).toBeVisible()
  await card.getByRole('button', { name: 'Review & send 1' }).click()
  await expect(page.getByText('Hi Sara, still looking for storage?')).toBeVisible()
  await page.getByRole('button', { name: 'Send 1 WhatsApp' }).click()
  await expect(page.getByText('1 sent.')).toBeVisible()
  expect(calls.find((c) => c.path.endsWith('/r3/send'))?.body).toEqual({ ids: ['w1'] })
})

test('list view: bots down the side, the chosen one\'s runs as a timeline', async ({ page }) => {
  await setup(page)
  await page.goto('/bots')
  await page.getByRole('button', { name: 'List' }).click()
  await expect(page.getByRole('button', { name: 'Open Renewal reminder emails' })).toContainText('2 waiting for you to send')
  await page.getByRole('button', { name: 'Open Competitor watch' }).click()
  const pane = page.getByLabel('Bot Competitor watch history')
  await expect(pane.getByText('AED 1,200')).toBeVisible()
  await expect(pane.getByRole('link', { name: /Competitor A/ })).toBeVisible()
  // The choice is remembered.
  await page.reload()
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
})

test('a running bot says so', async ({ page }) => {
  BOTS[1].runningSince = new Date().toISOString()
  try {
    await setup(page)
    await page.goto('/bots')
    await expect(page.getByLabel('Bot Competitor watch').getByText(/Running… since/)).toBeVisible()
    await expect(page.getByLabel('Bot Competitor watch').getByRole('button', { name: 'Running…' })).toBeDisabled()
  } finally {
    delete BOTS[1].runningSince
  }
})

test('a bot can be talked to: the message and its reply join its timeline', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/bots')
  await page.getByLabel('Bot Competitor watch').getByRole('button', { name: 'Chat' }).click()
  await page.getByLabel('Message Competitor watch').fill('run it every day at 8pm')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect.poll(() => calls.filter((c) => c.path === '/api/bots/b2/ask').length).toBe(1)
  const pane = page.getByLabel('Bot Competitor watch history')
  await expect(pane.getByText('run it every day at 8pm')).toBeVisible()
  await expect(pane.getByText('Done — Competitor watch now runs daily 20:00.')).toBeVisible()
})

test('a report bot can email its result to the team', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/bots')
  await page.getByRole('button', { name: 'New bot' }).click()
  await page.getByRole('button', { name: /Morning lead summary/ }).click()
  await page.getByLabel('Email the result to').fill('mase@purplebox.ae, ops@purplebox.ae')
  await page.getByRole('button', { name: 'Save bot' }).click()
  await expect.poll(() => calls.filter((c) => c.method === 'POST' && c.path === '/api/bots').length).toBe(1)
  const body = calls.find((c) => c.method === 'POST' && c.path === '/api/bots')!.body as Record<string, unknown>
  expect(body.emailTo).toEqual(['mase@purplebox.ae', 'ops@purplebox.ae'])
})
