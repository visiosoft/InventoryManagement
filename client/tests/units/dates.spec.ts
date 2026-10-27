import { test, expect } from '@playwright/test'

/* Stay dates: a unit's tenant shows with check-in and check-out, and
   4 weeks is 28 days — the check-out day is the last day of the stay. */

async function setup(page: import('@playwright/test').Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/units') return route.fulfill({ json: [{ _id: 'un1', unitNumber: 'F1-1', floor: 'F1', sizeSqf: 150, price: 2700, status: 'occupied' }] })
    if (path === '/api/units/active-contracts') return route.fulfill({ json: { byUnit: { un1: [{ contractId: 'k1', contractNo: 'C-1', customerName: 'Sara Ahmed', startDate: '2026-10-01T00:00:00Z', endDate: '2026-12-31T00:00:00Z', leased: 2700 }] } } })
    if (path === '/api/assistant/capabilities') return route.fulfill({ json: { enabled: false, allowed: false } })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages|customers|quotes|units|users/.test(path) ? [] : { items: [], total: 0, data: [] } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
}

test('the units table shows check in beside check out', async ({ page }) => {
  await setup(page)
  await page.goto('/units')
  await page.getByRole('button', { name: 'Table' }).click()
  await expect(page.getByRole('columnheader', { name: /Check in/ })).toBeVisible()
  const row = page.getByRole('row', { name: /F1-1/ })
  await expect(row).toContainText(/1 Oct 2026|Oct 1, 2026|01\/10\/2026/)
  await expect(row).toContainText(/31 Dec 2026|Dec 31, 2026|31\/12\/2026/)
})

test('a 4-week quote checks out on day 28, not day 29', async ({ page }) => {
  await setup(page)
  await page.goto('/quotes/new')
  await page.getByRole('button', { name: 'Units', exact: true }).click()
  const start = page.locator('input[type="date"]').first()
  await start.fill('2026-11-01')
  await page.locator('select').filter({ hasText: 'Custom end date' }).selectOption('4')
  await expect(page.getByText(/Ends on/)).toContainText('28-November-2026')
  await expect(page.getByText(/Ends on/)).toContainText('28 days · 4 weeks')
})
