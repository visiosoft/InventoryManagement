import { test, expect, type Page } from '@playwright/test'

/*
 * The dashboard's Customize, in the browser with the API mocked: hiding,
 * moving, and card widths — half-width cards sitting side by side — saved
 * to the person's account.
 */

async function open(page: Page) {
  let saved: Record<string, unknown> | null = null
  const puts: Record<string, unknown>[] = []
  const stub: Record<string, unknown> = {
    '/api/auth/me': { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } },
    '/api/reports/stats': { totalUnits: 364, byStatus: { available: 133, occupied: 156, reserved: 24, maintenance: 51 }, bySize: [{ sizeSqf: '10 sq ft', total: 21, available: 11, occupied: 10, maintenance: 0 }], occupancyPct: 58, activeContracts: 150, revenueThisMonth: 0, expectedThisMonth: 0, moveInsThisMonth: 0, moveInsLastMonth: 0, moveOutsThisMonth: 0, movingOutThisMonth: 0, monthLabel: 'October', moveOutsLastMonth: 0, moveInsList: [], moveOutsList: [], availableUnitsList: [] },
    '/api/reports/floor-occupancy': { byFloor: [{ floor: 'F1', total: 45, available: 3, occupied: 35, maintenance: 1 }] },
    '/api/lead-routing/now': { enabled: true, reps: [], handovers: [], signal: 'green', nobodyOn: false, live: { waitingForReply: 0, newLeadsToday: 0, repliesToday: 0 }, ai: { enabled: false, mode: 'draft', answering: false } },
    '/api/automation-rules/pending': { groups: [], total: 0 },
    '/api/accounts-dashboard/zoho-sales': { configured: false },
    '/api/accounts-dashboard/zoho-receivables': { configured: false },
  }
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path === '/api/auth/me/dashboard') {
      if (req.method() === 'PUT') { const body = JSON.parse(req.postData() || '{}'); saved = body.layout; puts.push(body.layout) }
      return route.fulfill({ json: { layout: saved } })
    }
    if (stub[path]) return route.fulfill({ json: stub[path] })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages/.test(path) ? [] : { items: [], total: 0 } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.setViewportSize({ width: 1400, height: 1400 })
  await page.goto('/')
  await page.getByRole('button', { name: /Customize/ }).click()
  return { puts }
}

/** The customize frame for a card, found by its label. */
const frame = (page: Page, label: string) => page.locator('div[style*="dashed"]').filter({ has: page.getByText(label, { exact: true }) }).first()

test('half-width cards fill two columns with no hole; full-width ones span the row', async ({ page }) => {
  await open(page)
  const halves = await Promise.all(['Units by size', 'Floor occupancy', 'Latest team tasks'].map((l) => frame(page, l).boundingBox()))
  const coverage = (await frame(page, 'Who is on now').boundingBox())!
  for (const b of halves) expect(b!.width).toBeLessThan(coverage.width * 0.55)
  // Two columns: some half cards on the left, some on the right.
  const xs = [...new Set(halves.map((b) => Math.round(b!.x)))]
  expect(xs.length).toBe(2)
  // Each column fills from the top: a card under another starts right below it, not after a hole.
  const left = halves.filter((b) => Math.round(b!.x) === Math.min(...xs)).sort((a, b) => a!.y - b!.y)
  for (let k = 1; k < left.length; k++) expect(left[k]!.y - (left[k - 1]!.y + left[k - 1]!.height)).toBeLessThan(30)
})

test('a card can be made half width, and back, and it is saved', async ({ page }) => {
  const { puts } = await open(page)
  const card = frame(page, 'Who is on now')
  const wide = (await card.boundingBox())!.width
  await card.getByRole('button', { name: 'Make half width' }).click()
  await expect.poll(() => puts.at(-1)?.sizes).toEqual({ 'lead-coverage': 'half' })
  await expect.poll(async () => (await card.boundingBox())!.width).toBeLessThan(wide * 0.6)
  await card.getByRole('button', { name: 'Make full width' }).click()
  await expect.poll(() => puts.at(-1)?.sizes).toEqual({})
  await expect.poll(async () => (await card.boundingBox())!.width).toBeGreaterThan(wide * 0.95)
})

test('a card that is half width by default can be made full width', async ({ page }) => {
  const { puts } = await open(page)
  await frame(page, 'Units by size').getByRole('button', { name: 'Make full width' }).click()
  await expect.poll(() => puts.at(-1)?.sizes).toEqual({ 'units-by-size': 'full' })
})

test('the key numbers stay full width', async ({ page }) => {
  await open(page)
  await expect(frame(page, 'Key numbers').getByRole('button', { name: /width/ })).toHaveCount(0)
})

test('hiding a card and adding it back is saved', async ({ page }) => {
  const { puts } = await open(page)
  await frame(page, 'Floor occupancy').getByRole('button', { name: 'Hide' }).click()
  await expect.poll(() => puts.at(-1)?.hidden).toEqual(['floor-occupancy'])
  await page.getByRole('button', { name: 'Floor occupancy' }).click()
  await expect.poll(() => puts.at(-1)?.hidden).toEqual([])
})

test('the layout survives a reload', async ({ page }) => {
  await open(page)
  await frame(page, 'Who is on now').getByRole('button', { name: 'Make half width' }).click()
  await page.waitForTimeout(300)
  await page.reload()
  await page.getByRole('button', { name: /Customize/ }).click()
  await expect(frame(page, 'Who is on now').getByRole('button', { name: 'Make full width' })).toBeVisible()
})
