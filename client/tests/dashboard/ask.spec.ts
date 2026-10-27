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
  await page.goto('/dashboard')
  await page.getByPlaceholder(/Ask anything/).fill('give me all leads from yesterday and today in pdf')
  await page.getByPlaceholder(/Ask anything/).press('Enter')
  await expect(page.getByText('the PDF is ready below')).toBeVisible()
  await expect(page.getByText('made the file')).toBeVisible()
  const popup = page.waitForEvent('popup').catch(() => null)
  await page.getByRole('button', { name: 'Download Leads (PDF)' }).click()
  await expect.poll(() => exported).toBe('?dataset=leads&format=pdf&from=2026-10-26&to=2026-10-27')
  await popup
})

test('booking a unit: it asks what it needs, remembers the answers, and ends in a Confirm card', async ({ page }) => {
  const sent: { question: string; history: { role: string; content: string }[] }[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/assistant/capabilities') return route.fulfill({ json: { enabled: true, allowed: true } })
    if (path === '/api/assistant/ask') {
      const body = JSON.parse(req.postData() || '{}')
      sent.push(body)
      if (sent.length === 1) {
        return route.fulfill({ json: { answer: 'Sure. 1. Customer name and phone? 2. Which size? 25 and 50 sq ft are free. 3. Start date and how long?', grounded: true, links: [], tools: [{ name: 'units_available', ok: true }], options: ['25 sq ft', '50 sq ft'] } })
      }
      if (sent.length === 2) {
        return route.fulfill({ json: { answer: 'Got it, 50 sq ft. Customer name, phone, start date and how long?', grounded: true, links: [], tools: [], options: [] } })
      }
      return route.fulfill({ json: {
        answer: 'Quotation ready — press **Confirm** below.', grounded: true, links: [], tools: [{ name: 'propose_quotation', ok: true }],
        pending: { id: 'p1', kind: 'create_quotation', summary: ['Quotation for Sara Ahmed (0501234567)', '50 sq ft · 1 Nov – 29 Nov', 'Total AED 829.00'], expiresAt: new Date(Date.now() + 9e5).toISOString() },
      } })
    }
    if (path === '/api/assistant/confirm') return route.fulfill({ json: { ok: true, message: 'Quotation QT-000201 created.', quoteId: 'q1' } })
    if (path === '/api/reports/stats') return route.fulfill({ status: 500, json: {} })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages/.test(path) ? [] : { items: [], total: 0, groups: [], reps: [], handovers: [], byFloor: [] } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Book a unit' }).click()
  await expect(page.getByText('Which size?')).toBeVisible()
  // Its question's answers are buttons; tapping one replies.
  await page.getByRole('button', { name: '50 sq ft' }).click()
  await expect(page.getByText('Got it, 50 sq ft.')).toBeVisible()
  expect(sent[1].question).toBe('50 sq ft')
  expect(sent[1].history.map((h) => h.role)).toEqual(['user', 'assistant'])
  expect(sent[1].history[0].content).toBe('Book a unit')
  // The earlier turns stay on screen.
  await expect(page.getByText('You: Book a unit')).toBeVisible()
  await page.getByPlaceholder('Reply, or ask something new…').fill('Sara Ahmed 0501234567, from 1 Nov for 4 weeks, WhatsApp')
  await page.getByPlaceholder('Reply, or ask something new…').press('Enter')
  await expect(page.getByText('Do this?')).toBeVisible()
  await expect(page.getByText('Total AED 829.00')).toBeVisible()
  expect(sent[2].history).toHaveLength(4)
  // **Confirm** is shown bold, not with stars.
  await expect(page.locator('b', { hasText: 'Confirm' })).toBeVisible()
  await page.getByRole('button', { name: /^Confirm/ }).click()
  await expect(page.getByText('Quotation QT-000201 created.')).toBeVisible()
  // X starts a fresh conversation.
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByRole('button', { name: 'Book a unit' })).toBeVisible()
})

test('details come as boxes the AI filled in; the answers go back as the next message', async ({ page }) => {
  const sent: { question: string; history: unknown[]; web: boolean }[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/assistant/capabilities') return route.fulfill({ json: { enabled: true, allowed: true, web: true } })
    if (path === '/api/assistant/recent') return route.fulfill({ json: { recent: [] } })
    if (path === '/api/assistant/ask') {
      const body = JSON.parse(req.postData() || '{}')
      sent.push(body)
      if (sent.length === 1) {
        return route.fulfill({ json: { answer: 'A few details for the quotation:', grounded: true, links: [], tools: [{ name: 'ask_details', ok: true }], form: {
          intro: 'A few details for the quotation:', title: 'Quotation', submitLabel: 'Prepare quotation',
          fields: [
            { key: 'customerName', label: 'Customer name', type: 'text', value: 'Sara Ahmed', required: true },
            { key: 'phone', label: 'Phone', type: 'phone', value: '', required: true },
            { key: 'sizeSqf', label: 'Unit size', type: 'select', options: ['25 sq ft', '50 sq ft'], value: '50 sq ft', required: true },
            { key: 'discount', label: 'Discount', type: 'number', value: '', required: false },
          ],
        } } })
      }
      return route.fulfill({ json: { answer: 'Rival Storage charges AED 450 a month.', grounded: true, links: [], tools: [{ name: 'web_search', ok: true }], sources: [{ label: 'Rival Storage prices', url: 'https://rival.example/prices' }] } })
    }
    if (path === '/api/reports/stats') return route.fulfill({ status: 500, json: {} })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages/.test(path) ? [] : { items: [], total: 0, groups: [], reps: [], handovers: [], byFloor: [] } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.goto('/dashboard')
  await page.getByPlaceholder(/Ask anything/).fill('quote for Sara')
  await page.getByPlaceholder(/Ask anything/).press('Enter')
  await expect(page.getByLabel('Customer name')).toHaveValue('Sara Ahmed')
  await expect(page.getByLabel('Unit size')).toHaveValue('50 sq ft')
  await page.getByRole('button', { name: 'Prepare quotation' }).click()
  await expect(page.getByText('Fill in phone.')).toBeVisible()
  expect(sent.length).toBe(1)
  await page.getByLabel('Phone').fill('0501234567')
  await page.getByRole('button', { name: 'Search the web' }).click()
  await page.getByRole('button', { name: 'Prepare quotation' }).click()
  await expect(page.getByText('AED 450 a month')).toBeVisible()
  expect(sent[1].question).toBe('Quotation details:\n- Customer name: Sara Ahmed\n- Phone: 0501234567\n- Unit size: 50 sq ft')
  expect(sent[1].history.length).toBe(2)
  expect(sent[1].web).toBe(true)
  await expect(page.getByRole('link', { name: /Rival Storage prices/ })).toHaveAttribute('href', 'https://rival.example/prices')
})

test('a chart drawn from the answer\'s own figures shows under it', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/assistant/capabilities') return route.fulfill({ json: { enabled: true, allowed: true } })
    if (path === '/api/assistant/recent') return route.fulfill({ json: { recent: [] } })
    if (path === '/api/assistant/ask') return route.fulfill({ json: { answer: 'Leads per day, last 3 days.', grounded: true, links: [], tools: [{ name: 'make_chart', ok: true }], charts: [{ type: 'bar', title: 'Leads per day', labels: ['Sat', 'Sun', 'Mon'], series: [{ name: 'Leads', values: [44, 52, 61] }] }] } })
    if (path === '/api/reports/stats') return route.fulfill({ status: 500, json: {} })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages|users/.test(path) ? [] : { items: [], total: 0, groups: [], reps: [], handovers: [], byFloor: [] } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.goto('/dashboard')
  await page.getByPlaceholder(/Ask anything/).fill('chart leads per day')
  await page.getByPlaceholder(/Ask anything/).press('Enter')
  const chart = page.getByLabel('Chart: Leads per day')
  await expect(chart).toBeVisible()
  await expect(chart.locator('.recharts-bar-rectangle')).toHaveCount(3)
  await expect(chart.getByRole('button', { name: 'Download chart' })).toBeVisible()
})
