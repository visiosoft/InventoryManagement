import test from 'node:test';
import assert from 'node:assert/strict';
import { isWaiting, summarise, waitingFor, DEFAULT_SLA_MINUTES } from './speedToLead.js';

const NOW = new Date('2026-08-27T10:00:00.000Z');
const minutesAgo = (n) => new Date(NOW.getTime() - n * 60_000);
const SLA = DEFAULT_SLA_MINUTES * 60_000;

const lead = (over = {}) => ({
  _id: 'l1', fullName: 'Ali', phone: '971502612729', status: 'new',
  owner: { _id: 'u1', name: 'Gilbert' },
  assignedAt: minutesAgo(5), firstResponseAt: null, ...over,
});

test('the default window is two minutes', () => {
  assert.equal(DEFAULT_SLA_MINUTES, 2);
});

test('waiting is measured from the assignment', () => {
  assert.equal(waitingFor(lead({ assignedAt: minutesAgo(3) }), NOW), 3 * 60_000);
});

test('a lead nobody was put on has waited for nothing', () => {
  assert.equal(waitingFor(lead({ assignedAt: null }), NOW), 0);
  assert.equal(waitingFor(lead({ assignedAt: 'not a date' }), NOW), 0);
});

test('a clock set in the future does not read as negative', () => {
  assert.equal(waitingFor(lead({ assignedAt: new Date(NOW.getTime() + 60_000) }), NOW), 0);
});

test('inside the window, nothing is called out', () => {
  assert.equal(isWaiting(lead({ assignedAt: minutesAgo(1) }), NOW, SLA), false);
});

test('exactly on the window counts — two minutes is the promise, not a target to beat', () => {
  assert.equal(isWaiting(lead({ assignedAt: minutesAgo(2) }), NOW, SLA), true);
});

test('past the window with nothing done is waiting', () => {
  assert.equal(isWaiting(lead(), NOW, SLA), true);
});

test('a lead somebody has acted on is not waiting, however late they were', () => {
  assert.equal(isWaiting(lead({ firstResponseAt: minutesAgo(1) }), NOW, SLA), false);
});

test('a lead that was never assigned never waits', () => {
  assert.equal(isWaiting(lead({ assignedAt: null }), NOW, SLA), false);
});

test('a lead nobody owns is nobody to chase', () => {
  assert.equal(isWaiting(lead({ owner: null }), NOW, SLA), false);
});

test('a finished lead is not somebody to call', () => {
  assert.equal(isWaiting(lead({ status: 'won' }), NOW, SLA), false);
  assert.equal(isWaiting(lead({ status: 'lost' }), NOW, SLA), false);
});

test('a lead mid-pipeline still counts — being assigned is what starts it', () => {
  assert.equal(isWaiting(lead({ status: 'quotation_sent' }), NOW, SLA), true);
});

test('longest wait first, so the panel reads in the order to work it', () => {
  const out = summarise([
    lead({ _id: 'a', fullName: 'Three', assignedAt: minutesAgo(3) }),
    lead({ _id: 'b', fullName: 'Nine', assignedAt: minutesAgo(9) }),
    lead({ _id: 'c', fullName: 'Five', assignedAt: minutesAgo(5) }),
  ], NOW);

  assert.deepEqual(out.rows.map((r) => r.fullName), ['Nine', 'Five', 'Three']);
  assert.equal(out.count, 3);
  assert.equal(out.longestMs, 9 * 60_000);
});

test('nothing waiting is an empty panel, not a zero-length one', () => {
  const out = summarise([lead({ assignedAt: minutesAgo(1) })], NOW);
  assert.equal(out.count, 0);
  assert.equal(out.longestMs, 0);
  assert.deepEqual(out.rows, []);
});

test('summarise reports the window it actually applied', () => {
  assert.equal(summarise([], NOW, 15).slaMinutes, 15);
  assert.equal(summarise([], NOW).slaMinutes, 2);
  // A nonsense window falls back rather than letting everything through.
  assert.equal(summarise([], NOW, 0).slaMinutes, 2);
  assert.equal(summarise([], NOW, 'soon').slaMinutes, 2);
});

test('a longer window quietens the same leads', () => {
  const leads = [lead({ assignedAt: minutesAgo(5) })];
  assert.equal(summarise(leads, NOW, 2).count, 1);
  assert.equal(summarise(leads, NOW, 10).count, 0);
});

test('a row carries who owns it, so the admin panel names somebody', () => {
  const [row] = summarise([lead()], NOW).rows;
  assert.equal(row.ownerName, 'Gilbert');
  assert.equal(row.fullName, 'Ali');
  assert.equal(row.waitedMs, 5 * 60_000);
});

test('a nameless lead is still identifiable by number', () => {
  const [row] = summarise([lead({ fullName: '' })], NOW).rows;
  assert.equal(row.fullName, '971502612729');
});
