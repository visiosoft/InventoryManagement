import { test, expect } from '@playwright/test'

/* Recent searches: the person's own last questions, and a click asks one
   again — fresh, with no earlier conversation sent along. */

test('recent searches list the person\'s questions and a click asks one again', async ({ page }) => {
  const asked: { question: string; history: unknown[] }[] = []
  let recent = [{ q: 'Who is on shift now?', at: new Date(Date.now() - 5 * 60000).toISOString() }]
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/assistant/capabilities') return route.fulfill({ json: { enabled: true, allowed: true } })
    if (path === '/api/assistant/recent' && req.method() === 'DELETE') { recent = []; return route.fulfill({ json: { ok: true } }) }
    if (path === '/api/assistant/recent') return route.fulfill({ json: { recent } })
    if (path === '/api/assistant/ask') {
      const body = JSON.parse(req.postData() || '{}')
      asked.push(body)
      if (!body.history.length) recent = [{ q: body.question, at: new Date().toISOString() }, ...recent.filter((r) => r.q !== body.question)]
      return route.fulfill({ json: { answer: `Answer ${asked.length}`, grounded: true, links: [], tools: [] } })
    }
    if (path === '/api/reports/stats') return route.fulfill({ status: 500, json: {} })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages/.test(path) ? [] : { items: [], total: 0, groups: [], reps: [], handovers: [], byFloor: [] } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.goto('/')
  await expect(page.getByText('Recent searches')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask again: Who is on shift now?' })).toBeVisible()

  // A new question joins the list.
  await page.getByPlaceholder(/Ask anything/).fill('Leads today')
  await page.getByPlaceholder(/Ask anything/).press('Enter')
  await expect(page.getByText('Answer 1')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask again: Leads today' })).toBeVisible()

  // A follow-up carries the thread; picking a recent search starts fresh.
  await page.getByPlaceholder(/Reply, or ask/).fill('and yesterday?')
  await page.getByPlaceholder(/Reply, or ask/).press('Enter')
  await expect(page.getByText('Answer 2')).toBeVisible()
  expect(asked[1].history.length).toBe(2)
  await page.getByRole('button', { name: 'Ask again: Who is on shift now?' }).click()
  await expect(page.getByText('Answer 3')).toBeVisible()
  expect(asked[2]).toMatchObject({ question: 'Who is on shift now?', history: [] })

  await page.getByRole('button', { name: 'Clear recent searches' }).click()
  await expect(page.getByText('What you ask above shows up here.')).toBeVisible()
})
