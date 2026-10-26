import { test, expect, type Page } from '@playwright/test'

/*
 * The lead distribution page, end to end in the browser with the API mocked:
 * the roster calendar, the hour window (who is on, even turns or a split),
 * dragging over several hours, the out-of-hours people, and that the old
 * settings are gone. Every save is checked by what is sent to the API.
 */

const RANDA = 'a'.repeat(24)
const MAHMOUD = 'b'.repeat(24)
const FORSON = 'c'.repeat(24)
const ADMIN = 'd'.repeat(24)
const shifts = (days: number[], start: string, end: string) => days.map((day) => ({ day, start, end }))

type Put = { path: string; body: Record<string, unknown> }

async function open(page: Page) {
  const state = {
    config: { enabled: true, hourSplits: [] as unknown[], outOfHoursUsers: [] as string[] },
    people: [
      { _id: RANDA, name: 'Randa Mustafa', role: 'sales_rep' },
      { _id: MAHMOUD, name: 'Mahmoud Gohar', role: 'sales_rep' },
      { _id: FORSON, name: 'Forson Yeboah', role: 'sales_rep' },
    ],
    staff: [
      { _id: ADMIN, name: 'Mase Rasti', role: 'admin' },
      { _id: RANDA, name: 'Randa Mustafa', role: 'sales_rep' },
    ],
    rules: [
      // The colours the old calendar saved (a purple and a green).
      { _id: 'r1', user: { _id: RANDA, name: 'Randa Mustafa' }, color: '#7B4BBF', rosterManaged: true, weeklyShifts: shifts([0, 1, 2, 4, 5, 6], '03:00', '18:00'), pushEnabled: false },
      { _id: 'r2', user: { _id: MAHMOUD, name: 'Mahmoud Gohar' }, color: '#3E8E6E', rosterManaged: true, weeklyShifts: shifts([0, 1, 2, 3, 4, 5], '15:00', '22:00'), pushEnabled: true },
    ],
  }
  const puts: Put[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() || '{}')
      puts.push({ path, body })
      if (path === '/api/lead-routing/config') Object.assign(state.config, body)
      const m = path.match(/rules\/(\w+)/)
      if (m) {
        let r = state.rules.find((x) => x.user._id === m[1])
        if (!r) {
          const person = state.people.find((x) => x._id === m[1])!
          r = { _id: `n${m[1]}`, user: { _id: person._id, name: person.name }, color: '', rosterManaged: true, weeklyShifts: [], pushEnabled: false }
          state.rules.push(r)
        }
        Object.assign(r, body)
      }
      return route.fulfill({ json: {} })
    }
    if (path === '/api/lead-routing') return route.fulfill({ json: state })
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    return route.fulfill({ json: /sites|conversations|messages|list/.test(path) ? [] : {} })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
  })
  await page.goto('/settings/lead-distribution')
  await expect(page.locator('td[data-day="1"][data-hour="10"]')).toBeVisible()
  return { puts, state }
}

const cell = (page: Page, day: number, hour: number) => page.locator(`td[data-day="${day}"][data-hour="${hour}"]`)
const dialog = (page: Page) => page.getByRole('dialog')

test('only the roster is on the page — the old settings are gone', async ({ page }) => {
  await open(page)
  // The top bar repeats the page name; the page's own heading is the last one.
  await expect(page.getByRole('heading', { name: 'Lead Distribution' }).last()).toBeVisible()
  await expect(page.getByText('Out of hours', { exact: true })).toBeVisible()
  for (const old of ['Sales reps', 'When a lead is not answered', 'People we already deal with', 'Key gap', 'Save roster', 'Pick a rep']) {
    await expect(page.getByText(old)).toHaveCount(0)
  }
})

test('cells show who is on, in soft colours, not the old purple', async ({ page }) => {
  await open(page)
  await expect(cell(page, 1, 10)).toHaveAttribute('title', /Randa Mustafa/)
  await expect(cell(page, 1, 16)).toHaveAttribute('title', /Randa Mustafa, Mahmoud Gohar/)
  await expect(cell(page, 3, 10)).toHaveAttribute('title', /nobody/)
  const bg = await cell(page, 1, 10).locator('div > div').first().evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe('rgb(201, 220, 248)') // the blue tint, #C9DCF8
  expect(bg).not.toBe('rgb(123, 75, 191)') // the old purple
  // Every hour of the day is labelled.
  for (const label of ['12 AM', '1 AM', '11 AM', '12 PM', '1 PM', '11 PM']) await expect(page.getByRole('cell', { name: label, exact: true })).toBeVisible()
  // The name once at the start of the block, not in every hour.
  await expect(cell(page, 1, 3)).toContainText('RANDA')
  await expect(cell(page, 1, 4)).not.toContainText('RANDA')
})

test('an hour can be split by percentage, which must total 100', async ({ page }) => {
  const { puts } = await open(page)
  await cell(page, 1, 16).click()
  await expect(dialog(page)).toContainText('Monday 4:00 PM')
  await expect(dialog(page)).toContainText('Taking turns')
  await dialog(page).getByLabel('Randa Mustafa share').fill('70')
  await dialog(page).getByLabel('Mahmoud Gohar share').fill('20')
  await expect(dialog(page)).toContainText('Total 90%')
  await expect(dialog(page).getByRole('button', { name: /^Apply/ })).toBeDisabled()
  await dialog(page).getByLabel('Mahmoud Gohar share').fill('30')
  await dialog(page).getByRole('button', { name: /^Apply/ }).click()
  await expect(dialog(page)).toHaveCount(0)
  const sent = puts.find((p) => p.path === '/api/lead-routing/config')
  expect(sent?.body.hourSplits).toEqual([{ day: 1, hour: 16, shares: [{ user: RANDA, pct: 70 }, { user: MAHMOUD, pct: 30 }] }])
  // Nobody's hours changed, so no rep was saved.
  expect(puts.filter((p) => p.path.includes('/rules/'))).toHaveLength(0)
  await expect(cell(page, 1, 16)).toContainText('70%')
  await expect(cell(page, 1, 16)).toContainText('30%')
})

test('Split evenly goes back to taking turns and clears the split', async ({ page }) => {
  const { puts } = await open(page)
  await cell(page, 1, 16).click()
  await dialog(page).getByLabel('Randa Mustafa share').fill('80')
  await dialog(page).getByRole('button', { name: 'Split evenly' }).click()
  await expect(dialog(page)).toContainText('Taking turns')
  await dialog(page).getByRole('button', { name: /^Apply/ }).click()
  expect(puts.find((p) => p.path === '/api/lead-routing/config')?.body.hourSplits).toEqual([])
})

test('adding someone to an hour saves their roster', async ({ page }) => {
  const { puts } = await open(page)
  await cell(page, 3, 10).click() // Wednesday 10am: nobody
  await expect(dialog(page)).toContainText('Wednesday 10:00 AM')
  await dialog(page).getByRole('checkbox', { name: /Forson Yeboah/ }).check()
  await dialog(page).getByRole('button', { name: /^Apply/ }).click()
  const forson = puts.find((p) => p.path === `/api/lead-routing/rules/${FORSON}`)
  expect(forson?.body.weeklyShifts).toEqual([{ day: 3, start: '10:00', end: '11:00' }])
  expect(forson?.body.status).toBe('active')
  await expect(cell(page, 3, 10)).toHaveAttribute('title', /Forson Yeboah/)
})

test('dragging over several hours sets them all at once', async ({ page }) => {
  const { puts } = await open(page)
  await page.setViewportSize({ width: 1280, height: 1100 })
  await cell(page, 6, 21).scrollIntoViewIfNeeded()
  const a = (await cell(page, 6, 18).boundingBox())!
  const z = (await cell(page, 6, 21).boundingBox())!
  await page.mouse.move(a.x + 5, a.y + 5)
  await page.mouse.down()
  await page.mouse.move(z.x + 5, z.y + 5, { steps: 8 })
  await page.mouse.up()
  await expect(dialog(page)).toContainText('Saturday 6:00 PM – 10:00 PM')
  await dialog(page).getByRole('checkbox', { name: /Mahmoud Gohar/ }).check()
  await dialog(page).getByRole('button', { name: 'Apply to 4 hours' }).click()
  const m = puts.find((p) => p.path === `/api/lead-routing/rules/${MAHMOUD}`)
  expect(m?.body.weeklyShifts).toContainEqual({ day: 6, start: '18:00', end: '22:00' })
})

test('unticking everyone turns an hour into a gap', async ({ page }) => {
  const { puts } = await open(page)
  await cell(page, 1, 10).click()
  await dialog(page).getByRole('checkbox', { name: /Randa Mustafa/ }).uncheck()
  await expect(dialog(page)).toContainText('Nobody on')
  await dialog(page).getByRole('button', { name: /^Apply/ }).click()
  const r = puts.find((p) => p.path === `/api/lead-routing/rules/${RANDA}`)
  expect(r?.body.weeklyShifts).toContainEqual({ day: 1, start: '03:00', end: '10:00' })
  expect(r?.body.weeklyShifts).toContainEqual({ day: 1, start: '11:00', end: '18:00' })
  await expect(cell(page, 1, 10)).toHaveAttribute('title', /nobody/)
})

test('out of hours: add and remove people, saved at once', async ({ page }) => {
  const { puts } = await open(page)
  await expect(page.getByText('waits for the next shift')).toBeVisible()
  await page.getByLabel('Add an out-of-hours person').selectOption({ label: 'Mase Rasti' })
  await expect.poll(() => puts.at(-1)?.body.outOfHoursUsers).toEqual([ADMIN])
  await page.getByLabel('Add an out-of-hours person').selectOption({ label: 'Randa Mustafa' })
  await expect.poll(() => puts.at(-1)?.body.outOfHoursUsers).toEqual([ADMIN, RANDA])
  await expect(page.getByText('take turns')).toBeVisible()
  await page.getByRole('button', { name: 'Remove Mase Rasti' }).click()
  await expect.poll(() => puts.at(-1)?.body.outOfHoursUsers).toEqual([RANDA])
})

test('the on/off switch saves', async ({ page }) => {
  const { puts } = await open(page)
  await page.getByRole('button', { name: /^On/ }).click()
  await expect.poll(() => puts.at(-1)?.body).toEqual({ enabled: false })
})
