import { test, expect } from '@playwright/test'

/* Status in Search Units comes from the contracts: signed is Occupied,
   an unsigned contract is Reserved, a quotation's two-day hold is Quoted. */

test('the status filter finds reserved and quoted units; the check-out warning follows the filters', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/units') return route.fulfill({ json: [
      { _id: 'a', unitNumber: 'F3-32', floor: 'F3', sizeSqf: 50, price: 975, status: 'reserved' },
      { _id: 'b', unitNumber: 'F1-40', floor: 'F1', sizeSqf: 150, price: 2700, status: 'reserved' },
      { _id: 'c', unitNumber: 'F3-5', floor: 'F3', sizeSqf: 50, price: 975, status: 'reserved' },
      { _id: 'd', unitNumber: 'F2-9', floor: 'F2', sizeSqf: 50, price: 975, status: 'occupied' },
    ] })
    if (path === '/api/units/active-contracts') return route.fulfill({ json: { byUnit: {
      c: [{ contractId: 'k1', contractNo: 'PB-0455', customerName: 'Diana', startDate: '2026-10-31T00:00:00Z', endDate: '2026-11-07T00:00:00Z', leased: 975 }],
      d: [{ contractId: 'k2', contractNo: 'PB-0100', customerName: 'Late', startDate: '2026-01-01T00:00:00Z', endDate: '2026-02-01T00:00:00Z', leased: 975 }],
    } } })
    if (path === '/api/quotes/available-units') return route.fulfill({ json: [
      { _id: 'a', bookings: [{ kind: 'contract', ref: 'PB-0460', customer: 'Beta', startDate: '2026-10-23', endDate: '2026-11-20', status: 'pending_signature' }] },
      { _id: 'b', bookings: [{ kind: 'quote', ref: 'QT-000310', customer: 'Abd', startDate: '2026-10-31', endDate: '2026-11-14', status: 'sent' }] },
    ] })
    if (path === '/api/assistant/capabilities') return route.fulfill({ json: { enabled: false, allowed: false } })
    return route.fulfill({ json: /tasks|expiring|sites|list|conversations|messages|customers|quotes|units|users/.test(path) ? [] : { items: [], total: 0, data: [] } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.goto('/units')
  await expect(page.getByText(/1 unit is past the tenant/)).toBeVisible()
  const status = page.locator('select').filter({ hasText: 'Reserved' })
  await status.selectOption('reserved')
  await expect(page.getByText('F3-32', { exact: true })).toBeVisible()
  await expect(page.getByText('F1-40', { exact: true })).toHaveCount(0)
  await expect(page.getByText('F3-5', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/past the tenant/)).toHaveCount(0)
  await status.selectOption('quoted')
  await expect(page.getByText('F1-40', { exact: true })).toBeVisible()
})
