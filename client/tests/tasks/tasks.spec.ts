import { test, expect, type Page } from '@playwright/test'

/*
 * The Tasks page with the API mocked: grouped by when tasks are due, quick
 * add, ticking off, search, completed tucked away, and the other views.
 */

const day = 86400000
const at = (offsetDays: number, hour = 15) => {
  const d = new Date(); d.setHours(hour, 0, 0, 0)
  return new Date(d.getTime() + offsetDays * day).toISOString()
}
const ME = { _id: 'u1', name: 'Mase Rasti', email: 'm@x' }
const RANDA = { _id: 'u2', name: 'Randa Mustafa', email: 'r@x' }

function seed() {
  return [
    { _id: 't1', title: 'Call back Whetu about the 50 sq ft unit', dueDate: at(-2), priority: 'high', status: 'todo', assignedTo: RANDA, leadName: 'PB-2026-0389', createdAt: at(-5) },
    { _id: 't2', title: 'Send renewal quote', description: 'Unit F2-09, 3 months', dueDate: at(0), priority: 'medium', status: 'in_progress', assignedTo: ME, createdAt: at(-1) },
    { _id: 't3', title: 'Check the door terminal Wi-Fi', dueDate: at(1), priority: 'low', status: 'todo', assignedTo: ME, createdAt: at(-1) },
    { _id: 't4', title: 'Order boxes', dueDate: at(10), priority: 'low', status: 'todo', assignedTo: ME, createdAt: at(-1) },
    { _id: 't5', title: 'Tidy the storeroom', priority: 'low', status: 'todo', assignedTo: ME, createdAt: at(-3) },
    { _id: 't6', title: 'Move-in for Ali Khan', dueDate: at(-1), priority: 'medium', status: 'done', assignedTo: ME, createdAt: at(-4) },
  ]
}

async function open(page: Page) {
  const tasks = seed()
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = []
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const body = req.postData() ? JSON.parse(req.postData()!) : {}
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'u1', name: 'Mase', role: 'admin', permissions: [] } } })
    if (path === '/api/users/assignable') return route.fulfill({ json: [ME, RANDA].map((u) => ({ ...u, role: 'admin' })) })
    if (path === '/api/tasks' && req.method() === 'GET') return route.fulfill({ json: tasks })
    if (path === '/api/tasks' && req.method() === 'POST') {
      calls.push({ method: 'POST', path, body })
      tasks.unshift({ _id: `n${tasks.length}`, title: body.title, priority: 'medium', status: 'todo', assignedTo: ME, createdAt: new Date().toISOString() } as never)
      return route.fulfill({ json: { ok: true } })
    }
    const m = path.match(/^\/api\/tasks\/(\w+)$/)
    if (m && req.method() === 'GET') return route.fulfill({ json: { ...tasks.find((t) => t._id === m[1]), comments: [], attachments: [], activity: [] } })
    if (m && req.method() === 'PATCH') {
      calls.push({ method: 'PATCH', path, body })
      Object.assign(tasks.find((t) => t._id === m[1])!, body)
      return route.fulfill({ json: { ok: true } })
    }
    return route.fulfill({ json: /sites|conversations|messages|list|renewal|contracts/.test(path) ? [] : {} })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 't')
    localStorage.setItem('pb_user', JSON.stringify({ id: 'u1', name: 'Mase', role: 'admin', permissions: [] }))
    localStorage.removeItem('pb_tasks_view')
  })
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true }).last()).toBeVisible()
  return { calls }
}

const section = (page: Page, name: string) => page.getByRole('region', { name })

test('the list is the default, grouped by when things are due', async ({ page }) => {
  await open(page)
  await expect(page.getByText('5 open')).toBeVisible()
  await expect(page.getByText('1 overdue')).toBeVisible()
  await expect(page.getByText('1 due today')).toBeVisible()
  await expect(section(page, 'Overdue')).toContainText('Call back Whetu')
  await expect(section(page, 'Today')).toContainText('Send renewal quote')
  await expect(section(page, 'Today')).toContainText('In progress')
  await expect(section(page, 'Tomorrow')).toContainText('Check the door terminal Wi-Fi')
  await expect(section(page, 'Later')).toContainText('Order boxes')
  await expect(section(page, 'No due date')).toContainText('Tidy the storeroom')
  // Done work is tucked away until asked for.
  await expect(section(page, 'Completed')).not.toContainText('Move-in for Ali Khan')
  await section(page, 'Completed').getByRole('button', { name: /Show/ }).click()
  await expect(section(page, 'Completed')).toContainText('Move-in for Ali Khan')
})

test('quick add: type and press Enter', async ({ page }) => {
  const { calls } = await open(page)
  await page.getByLabel('Add a task').fill('Collect keys from F1-36')
  await page.getByLabel('Add a task').press('Enter')
  await expect.poll(() => calls.find((c) => c.method === 'POST')?.body).toEqual({ title: 'Collect keys from F1-36', priority: 'medium' })
  await expect(page.getByLabel('Add a task')).toHaveValue('')
  await expect(section(page, 'No due date')).toContainText('Collect keys from F1-36')
})

test('ticking a task completes it, and it moves to Completed', async ({ page }) => {
  const { calls } = await open(page)
  await page.getByRole('button', { name: 'Complete "Order boxes"' }).click()
  await expect.poll(() => calls.find((c) => c.method === 'PATCH')).toEqual({ method: 'PATCH', path: '/api/tasks/t4', body: { status: 'done' } })
  await expect(page.getByText('4 open')).toBeVisible()
})

test('search narrows every group', async ({ page }) => {
  await open(page)
  await page.getByLabel('Search tasks').fill('renewal')
  await expect(page.getByText('Send renewal quote')).toBeVisible()
  await expect(page.getByText('Order boxes')).toHaveCount(0)
  await page.getByLabel('Search tasks').fill('Randa')
  await expect(page.getByText('Call back Whetu about the 50 sq ft unit')).toBeVisible()
  await expect(page.getByText('Send renewal quote')).toHaveCount(0)
})

test('clicking a task opens it', async ({ page }) => {
  await open(page)
  await page.getByText('Send renewal quote').click()
  await expect(page.getByText('Unit F2-09, 3 months').last()).toBeVisible()
})

test('board and calendar are a click away, and the choice is remembered', async ({ page }) => {
  await open(page)
  await page.getByRole('tab', { name: 'Board' }).click()
  await expect(page.getByText('To do', { exact: true }).first()).toBeVisible()
  await page.getByRole('tab', { name: 'Calendar' }).click()
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('pb_tasks_view'))).toBe('calendar')
})
