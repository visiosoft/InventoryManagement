import { test, expect } from '@playwright/test'

/* The dashboard's Ask box: an answer that made a file shows a Download
   button, and the download fetches the file with the person's own login. */

test('asking for leads as a PDF gives a download button that fetches the file', async ({ page }) => {
  let exported = ''
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/assistant/capabilities') return route.fulfill({ json: { enabled: true, allowed: true } })
    if (path === '/api/assistant/ask') {
      return route.fulfill({ json: {
        answer: '97 leads from yesterday and today — the PDF is ready below.', grounded: true, links: [],
        tools: [{ name: 'export_file', ok: true }],
        files: [{ label: 'Leads (PDF)', path: '/assistant/export?dataset=leads&format=pdf&from=2026-10-26&to=2026-10-27', format: 'pdf' }],
      } })
    }
    if (path === '/api/assistant/export') {
      exported = url.search
      return route.fulfill({ body: Buffer.from('%PDF-1.4\n%%EOF'), contentType: 'application/pdf' })
    }
    if (path === '/api/reports/stats') return route.fulfill({ status: 500, json: {} })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages/.test(path) ? [] : { items: [], total: 0, groups: [], reps: [], handovers: [], byFloor: [] } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.goto('/')
  await page.getByPlaceholder(/Ask about/).fill('give me all leads from yesterday and today in pdf')
  await page.getByPlaceholder(/Ask about/).press('Enter')
  await expect(page.getByText('the PDF is ready below')).toBeVisible()
  await expect(page.getByText('made the file')).toBeVisible()
  const popup = page.waitForEvent('popup').catch(() => null)
  await page.getByRole('button', { name: 'Download Leads (PDF)' }).click()
  await expect.poll(() => exported).toBe('?dataset=leads&format=pdf&from=2026-10-26&to=2026-10-27')
  await popup
})
