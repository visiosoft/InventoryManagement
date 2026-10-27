import { test, expect } from '@playwright/test'

/* Bot results reach the person on any page: a count in the top bar, the
   list on a click, a toast when one arrives, and a click opens that bot. */

test('the bell counts new bot results, toasts a new one, and opens the bot', async ({ page }) => {
  test.setTimeout(60_000)
  let inbox = [
    { runId: 'r1', botId: 'b1', name: 'Morning summary', icon: '☀️', at: new Date().toISOString(), line: 'Leads yesterday: 61', replied: false, needsAction: false },
  ]
  const seen: unknown[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/bots/inbox') return route.fulfill({ json: { count: inbox.length, items: inbox } })
    if (path === '/api/bots/inbox/seen') { seen.push(JSON.parse(req.postData() || '{}')); inbox = []; return route.fulfill({ json: { ok: true } }) }
    if (path === '/api/bots') return route.fulfill({ json: { bots: [{ _id: 'b1', name: 'Morning summary', kind: 'ai_report', icon: '☀️', instruction: 'x', web: false, days: 30, subject: '', message: '', quietDays: 3, maxQuietDays: 30, templateName: '', templateLanguage: 'en', sendMode: 'review', dailyCap: 50, schedule: { cadence: 'daily', hour: 9, dayOfWeek: 1, dayOfMonth: 1 }, showOnDashboard: true, enabled: true, scheduleLabel: 'Daily 09:00', unread: inbox.length, lastRun: { _id: 'r1', createdAt: new Date().toISOString(), status: 'ok', summary: '', answer: 'Leads yesterday: 61', sources: [], items: [], error: '' } }], defaults: { subject: '', message: '' } } })
    if (path === '/api/bots/b1/runs') return route.fulfill({ json: { runs: [{ _id: 'r1', createdAt: new Date().toISOString(), status: 'ok', summary: '', answer: 'Leads yesterday: 61', sources: [], items: [], error: '' }] } })
    if (path === '/api/reports/stats') return route.fulfill({ status: 500, json: {} })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages|users/.test(path) ? [] : { items: [], total: 0, groups: [], reps: [], handovers: [], byFloor: [] } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.goto('/dashboard')
  const bell = page.getByRole('button', { name: /Bot results \(1 new\)/ })
  await expect(bell).toBeVisible()

  // A new result lands while on another page: a toast.
  inbox = [{ runId: 'r2', botId: 'b1', name: 'Competitor watch', icon: '🔎', at: new Date().toISOString(), line: 'Delight: AED 900 for 50 sq ft', replied: true, needsAction: false }, ...inbox]
  // The bell looks again every 20 seconds.
  await page.waitForTimeout(21_000)
  await expect(page.getByRole('status').getByText('Competitor watch replied')).toBeVisible()

  await page.getByRole('button', { name: /Bot results \(2 new\)/ }).click()
  await page.getByRole('dialog', { name: 'Bot results' }).getByText('Morning summary').click()
  await expect(page).toHaveURL(/\/bots/)
  await expect(page.getByLabel('Bot Morning summary history').getByText('Leads yesterday: 61')).toBeVisible()
  await expect.poll(() => seen.length).toBeGreaterThan(0)
  expect(seen[0]).toEqual({ botId: 'b1' })
})
