// Run against the local Vite server. All API calls are intercepted; no real leads are changed.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { buildFunnel, buildForecast } from '../../server/src/services/leadFunnel.js';

const base = process.env.LEAD_SMOKE_URL || 'http://127.0.0.1:5178';
const owner = { _id: 'rep1', name: 'Test representative', email: 'rep@example.test' };
const fixture = (id, name, status = 'new') => ({ _id: id, fullName: name, firstName: name, phone: '+971501234567', phoneNormalized: '971501234567', status, owner, source: 'manual', storageSizeValue: 50, storageSizeUnit: 'sqft', durationValue: 1, durationUnit: 'month', unitsNeeded: 1, leadDateTime: '2026-09-01T10:00:00Z', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z', timeline: [] });
let leads = [fixture('lead1', 'Pipeline smoke lead'), fixture('lead2', 'Existing customer', 'already_customer'), ...Array.from({ length: 26 }, (_, i) => fixture(`page${i}`, `Pagination lead ${i + 1}`, 'contacted'))];
const requests = [];
const patches = [];
let rejectNext = false;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('pb_token', 'smoke-only');
    localStorage.setItem('pb_user', JSON.stringify({ id: 'admin', name: 'Smoke tester', role: 'admin', permissions: [], isActive: true }));
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    requests.push(url.pathname + url.search);
    const send = (json, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (path === '/auth/me') return send({ user: { id: 'admin', name: 'Smoke tester', role: 'admin', permissions: [] } });
    if (path === '/users/assignable') return send([owner]);
    if (path === '/leads/stats') return send({ total: leads.length, byStatus: Object.fromEntries([...new Set(leads.map(l => l.status))].map(status => [status, leads.filter(l => l.status === status).length])), unassigned: 0, byOwner: [], chase: { none: leads.length, active: 0, exhausted: 0 } });
    if (path === '/leads/waiting') return send({ count: 0, rows: [], slaMinutes: 2, longestMs: 0 });
    if (path === '/leads/nav-order') return send({ ids: leads.map(lead => lead._id) });
    if (path === '/leads/funnel') {
      const result = buildFunnel(leads);
      return send({ ...result, forecast: buildForecast(leads, [], result.history), since: null });
    }
    if (path === '/leads') {
      let rows = leads.filter(lead => !url.searchParams.get('status') || lead.status === url.searchParams.get('status'));
      const search = url.searchParams.get('search');
      if (search) rows = rows.filter(lead => lead.fullName.toLowerCase().includes(search.toLowerCase()));
      const number = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 25);
      return send({ data: rows.slice((number - 1) * limit, number * limit), total: rows.length, page: number, limit, pages: Math.ceil(rows.length / limit) });
    }
    const match = path.match(/^\/leads\/([^/]+)(\/status)?$/);
    if (match) {
      const lead = leads.find(lead => lead._id === match[1]);
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        patches.push(body);
        if (rejectNext) { rejectNext = false; return send({ error: 'This lead changed since you opened it. Refresh and try again.' }, 409); }
        leads = leads.map(row => row._id === lead._id ? { ...row, ...body, updatedAt: new Date().toISOString() } : row);
        return send(leads.find(row => row._id === lead._id));
      }
      return send(lead);
    }
    if (/notifications|alerts|unseen|counts/.test(path)) return send({ count: 0, unread: 0, rows: [], items: [], notifications: [] });
    if (path === '/settings') return send({});
    return send([]);
  });
  await page.goto(`${base}/leads`);
  await page.getByRole('button', { name: 'Pipeline smoke lead', exact: true }).waitFor();
  const board = page.locator('[aria-label="Lead pipeline"]');
  assert.equal(await board.locator('section').count(), 9);

  // Pointer drag into the adjacent empty stage.
  const handle = page.getByRole('button', { name: /^Drag Pipeline smoke lead/ });
  const target = board.locator('section').nth(1);
  const from = await handle.boundingBox(), to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 90, { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('select[aria-label="Move Pipeline smoke lead to stage"]')?.value === 'contact_attempted');
  assert.equal(patches[0].expectedStatus, 'new');
  assert.ok(patches[0].expectedUpdatedAt);

  // Stage changes requiring details must not write until the form is complete.
  const move = page.getByLabel('Move Pipeline smoke lead to stage');
  await move.selectOption('lost');
  await page.locator('select[name="lossReason"]').waitFor();
  assert.equal(patches.length, 1);
  await page.getByRole('button', { name: 'Save stage', exact: true }).click();
  assert.equal(patches.length, 1);
  await page.locator('select[name="lossReason"]').selectOption('price');
  await page.locator('input[name="lossCompetitor"]').fill('Comparison provider');
  await page.getByRole('button', { name: 'Save stage', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="Move Pipeline smoke lead to stage"]')?.value === 'lost');
  assert.equal(patches.at(-1).lossReason, 'price');

  await move.selectOption('follow_up_scheduled');
  await page.locator('input[name="followUpAt"]').fill('2030-01-10T14:30');
  await page.locator('input[name="followUpNote"]').fill('Discuss revised quotation');
  await page.getByRole('button', { name: 'Save stage', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="Move Pipeline smoke lead to stage"]')?.value === 'follow_up_scheduled');
  assert.equal(patches.at(-1).followUpAt, '2030-01-10T10:30:00.000Z');

  rejectNext = true;
  await move.selectOption('won');
  await page.getByText(/Could not move lead:/).waitFor();
  assert.equal(await move.inputValue(), 'follow_up_scheduled');

  await page.getByRole('button', { name: /Load more/ }).click();
  await page.getByRole('button', { name: 'Pagination lead 26', exact: true }).waitFor();
  await page.getByRole('button', { name: /Lead funnel/ }).click();
  await page.getByRole('heading', { name: 'Recorded conversions' }).waitFor();
  await page.getByRole('heading', { name: 'Quote value forecast' }).waitFor();
  await Promise.all([page.waitForResponse(response => response.url().includes('/leads/funnel?') && response.url().includes('nextAction=missing')), page.getByLabel('Next action', { exact: true }).selectOption('missing')]);
  assert.ok(requests.some(url => url.includes('/leads?') && url.includes('nextAction=missing')));
  await page.getByRole('button', { name: /Lead funnel/ }).click();
  await mkdir('test-results/lead-pipeline', { recursive: true });
  await page.screenshot({ path: 'test-results/lead-pipeline/desktop.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.lead-content').getBoundingClientRect().left < 20);
  assert.ok((await page.locator('.lead-content').boundingBox()).width <= 390, 'mobile content must fit the viewport');
  await page.screenshot({ path: 'test-results/lead-pipeline/mobile.png', fullPage: false });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'page should not overflow horizontally');
  assert.deepEqual(errors, []);
  console.log('PASS: nine stages, pointer drag, guarded saves, loss validation, Dubai scheduling, conflict feedback, column pagination, shared report filters, desktop/mobile rendering. API mocked; no production writes.');
} finally {
  await browser.close();
}
