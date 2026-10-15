import { test, expect } from '@playwright/test'

const site = '111111111111111111111111'
const userId = '222222222222222222222222'
const customer = { _id: '333333333333333333333333', fullName: 'John Smith', clientId: 'PB-1001' }
const location = { _id: '11111111-1111-4111-8111-111111111111', site, name: 'Rack B12 · Shelf 04', displayCode: 'PBX-LOC-000001', warehouse: 'WH1', kind: 'SHELF', usedContainers: 0, usedWeight: 0, usedVolume: 0, maxContainers: 5 }
const receiving = { ...location, _id: '44444444-4444-4444-8444-444444444444', name: 'Receiving area', displayCode: 'PBX-LOC-000002', kind: 'RECEIVING' }
const box = { _id: '22222222-2222-4222-8222-222222222222', displayCode: 'PBX-BX-000001', type: 'BOX', customer, warehouse: 'WH1', description: 'Winter clothing', contents: 'Jackets and boots', condition: 'GOOD', currentStatus: 'AWAITING_PUTAWAY', currentLocation: receiving, photoCount: 1, photos: [], weight: 5, length: 60, width: 40, height: 40, volume: .096, createdAt: '2026-09-18T10:00:00Z', nextAction: 'Scan a storage location to confirm putaway.' }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ site, userId }) => {
    if (!localStorage.getItem('pb_user')) {
      localStorage.setItem('pb_token', 'browser-test-only')
      localStorage.setItem('pb_user', JSON.stringify({ id: userId, name: 'Ahmed', role: 'staff', permissions: ['warehouse'], isActive: true }))
      localStorage.setItem('pb_site_id', site)
    }
  }, { site, userId })
  let current = { ...box }
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    let data: unknown = {}
    if (pathname === '/api/sites') data = [{ _id: site, name: 'Al Quoz', code: 'AQ', isDefault: true }]
    if (pathname === '/api/warehouse/locations') data = [location, receiving]
    if (pathname === '/api/warehouse/summary') data = { CREATED: 0, RECEIVED: 0, AWAITING_PUTAWAY: current.currentStatus === 'IN_STORAGE' ? 0 : 1, IN_STORAGE: current.currentStatus === 'IN_STORAGE' ? 1 : 0 }
    if (pathname === '/api/warehouse/containers') data = route.request().method() === 'POST' ? { containers: Array.from({ length: 5 }, (_, i) => ({ ...box, displayCode: `PBX-BX-00000${i + 1}` })) } : { data: [current], total: 1, pages: 1 }
    if (pathname === `/api/warehouse/containers/${box._id}`) data = current
    if (pathname.endsWith('/events')) data = { data: [{ _id: 'event', eventType: 'RECEIVE', employee: { name: 'Ahmed' }, timestamp: '2026-09-18T10:00:00Z', newStatus: 'RECEIVED' }], total: 1 }
    if (pathname.endsWith('/suggestions')) data = [location]
    if (pathname === '/api/warehouse/customers') data = [customer]
    if (pathname.endsWith('/bookings')) data = [{ _id: '555555555555555555555555', contractNo: 'BK-10492', unit: { _id: '666666666666666666666666', unitNumber: 'F2-041' }, status: 'active' }]
    if (pathname === '/api/warehouse/scans') {
      const body = route.request().postDataJSON()
      if (body.action === 'PUTAWAY') current = { ...current, currentStatus: 'IN_STORAGE', currentLocation: location, nextAction: 'In storage. A supervisor authorization is required to relocate this item.' }
      data = body.barcode === location.displayCode ? { recognized: true, objectType: 'LOCATION', location } : { recognized: true, objectType: 'BOX', container: current, nextAction: current.nextAction }
    }
    await route.fulfill({ json: data })
  })
})

test('scan item and shelf before confirming putaway', async ({ page }) => {
  await page.goto('/warehouse')
  await expect(page.getByRole('heading', { name: 'Stored inventory', exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'Warehouse navigation' }).getByRole('button', { name: 'Scan', exact: true }).click()
  const code = page.getByRole('textbox', { name: 'Scan or enter a PurpleBox code' })
  await code.fill(box.displayCode); await code.press('Enter')
  const confirm = page.getByRole('button', { name: 'Confirm putaway' })
  await expect(confirm).toBeDisabled()
  await code.fill(location.displayCode); await code.press('Enter')
  await expect(confirm).toBeEnabled()
  const sent = page.waitForRequest(req => req.url().endsWith('/warehouse/scans') && req.postDataJSON()?.action === 'PUTAWAY')
  await confirm.click()
  expect((await sent).postDataJSON()).toMatchObject({ barcode: box.displayCode, locationBarcode: location.displayCode, action: 'PUTAWAY' })
  await expect(page.getByText('NO ACTIVE MOVEMENT AUTHORIZATION', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/warehouse-desktop.png', fullPage: true })
})

test('receiving reuses the selected customer and booking and prepares five labels', async ({ page }) => {
  await page.goto('/warehouse')
  await page.getByRole('button', { name: 'Receive', exact: true }).click()
  await page.getByRole('textbox', { name: 'Find existing customer' }).fill('John')
  await page.getByRole('button', { name: 'John Smith PB-1001' }).click()
  await page.getByLabel('Booking', { exact: true }).selectOption('555555555555555555555555')
  await page.getByLabel('Warehouse', { exact: true }).selectOption('WH1')
  await page.getByLabel('Quantity', { exact: true }).fill('5')
  const sent = page.waitForRequest(req => req.url().endsWith('/warehouse/containers') && req.method() === 'POST')
  await page.getByRole('button', { name: 'Create items & prepare labels' }).click()
  expect((await sent).postDataJSON()).toMatchObject({ customer: customer._id, booking: '555555555555555555555555', quantity: 5 })
  await expect(page.getByRole('heading', { name: 'Label center' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Label codes, one per line' })).toHaveValue(/PBX-BX-000005/)
})

test('failed scan persists across reload and retries with its original request ID', async ({ page }) => {
  let requestId = ''
  await page.route('**/api/warehouse/scans', async route => {
    requestId = route.request().postDataJSON().requestId
    await route.abort('internetdisconnected')
  })
  await page.goto('/warehouse')
  await page.getByRole('navigation', { name: 'Warehouse navigation' }).getByRole('button', { name: 'Scan', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Scan or enter a PurpleBox code' })
  await input.fill(box.displayCode); await input.press('Enter')
  await expect(page.getByRole('heading', { name: '1 pending scan' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '1 pending scan' })).toBeVisible()
  await page.unroute('**/api/warehouse/scans')
  const retried = page.waitForRequest(req => req.url().endsWith('/warehouse/scans'))
  await page.getByRole('button', { name: 'Retry scan', exact: true }).click()
  expect((await retried).postDataJSON().requestId).toBe(requestId)
  await expect(page.getByRole('heading', { name: '1 pending scan' })).toHaveCount(0)
})

test('warehouse dashboard and receiving form fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/warehouse')
  await expect(page.getByRole('heading', { name: 'Stored inventory', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/warehouse-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Receive', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Find existing customer' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
