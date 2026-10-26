import { test, expect, type Page } from '@playwright/test'

/*
 * The Door Access page with the API mocked: connecting the terminal, the
 * access log, and linking somebody on the device to a customer.
 */

const SECRET = 'k3y-s3cret'
async function open(page: Page, { events = [] as unknown[], people = [] as unknown[], lastEventAt = null as string | null } = {}) {
  const puts: { path: string; body: unknown }[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    if (req.method() === 'PUT') { puts.push({ path, body: JSON.parse(req.postData() || '{}') }); return route.fulfill({ json: { ok: true } }) }
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/door/setup') return route.fulfill({ json: { url: `https://api.purplebox.ae/api/public/door/${SECRET}`, host: 'api.purplebox.ae', path: `/api/public/door/${SECRET}`, lastEventAt, lastDevice: null } })
    if (path === '/api/door/events') return route.fulfill({ json: { days: Number(url.searchParams.get('days')), events } })
    if (path === '/api/door/people') return route.fulfill({ json: { people } })
    if (path === '/api/customers') return route.fulfill({ json: { data: [{ _id: 'cust1', fullName: 'Whetu Seymour', phone: '0501234567' }], total: 1 } })
    return route.fulfill({ json: /sites|conversations|messages|list/.test(path) ? [] : {} })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.goto('/door-access')
  return { puts }
}

const now = () => new Date().toISOString()

test('before the terminal has sent anything, it shows how to connect it', async ({ page }) => {
  await open(page)
  await expect(page.getByText('Waiting for the terminal')).toBeVisible()
  await expect(page.getByText('Connect the terminal')).toBeVisible()
  await expect(page.getByText('api.purplebox.ae', { exact: true })).toBeVisible()
  await expect(page.getByText(`/api/public/door/${SECRET}`)).toBeVisible()
  await expect(page.getByText('No door activity today.')).toBeVisible()
})

test('once connected, setup hides and the log shows who came in, how', async ({ page }) => {
  await open(page, {
    lastEventAt: now(),
    events: [
      { _id: 'e1', at: now(), kind: 'granted', method: 'face', label: 'Face check passed', employeeNo: '12', personName: 'Whetu Seymour', customer: { _id: 'cust1', fullName: 'Whetu Seymour' } },
      { _id: 'e2', at: now(), kind: 'door', method: '', label: 'Door unlocked', employeeNo: '', personName: '', customer: null },
      { _id: 'e3', at: now(), kind: 'other', method: 'face', label: 'Event 5/76', employeeNo: '', personName: '', customer: null },
    ],
  })
  await expect(page.getByText(/Terminal connected/)).toBeVisible()
  await expect(page.getByText('Connect the terminal')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Whetu Seymour' })).toHaveAttribute('href', '/customers/cust1')
  await expect(page.getByText('Face check passed')).toBeVisible()
  await expect(page.getByText('Door unlocked')).toBeVisible()
  await expect(page.getByText('Event 5/76')).toBeVisible()
  // The setup is still a click away.
  await page.getByRole('button', { name: 'Setup' }).click()
  await expect(page.getByText('Connect the terminal')).toBeVisible()
})

test('someone on the device can be linked to a customer', async ({ page }) => {
  const { puts } = await open(page, { lastEventAt: now(), people: [{ _id: 'p1', employeeNo: '12', name: 'W Seymour', customer: null, matchedBy: '' }] })
  await expect(page.getByText('Not linked to a customer yet')).toBeVisible()
  await page.getByLabel('Find a customer').fill('Whetu')
  await page.getByRole('button', { name: /Whetu Seymour/ }).click()
  await expect.poll(() => puts.at(-1)).toEqual({ path: '/api/door/people/12', body: { customerId: 'cust1' } })
})

test('the period buttons ask for that many days', async ({ page }) => {
  await open(page, { lastEventAt: now() })
  const asked = page.waitForRequest((r) => r.url().includes('/api/door/events') && r.url().includes('days=7'))
  await page.getByRole('button', { name: '7 days' }).click()
  await asked
  await expect(page.getByText('No door activity in the last 7 days.')).toBeVisible()
})
