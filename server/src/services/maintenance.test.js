import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slaDue, slaState, canMove, statusAfterLastTicket, blocksUnit, suggestSeverity } from './maintenance.js';

const t0 = new Date('2026-10-28T08:00:00Z');

test('provisional SLA by severity', () => {
   assert.equal(slaDue('S1', t0).responseDueAt.toISOString(), '2026-10-28T12:00:00.000Z');
   assert.equal(slaDue('S1', t0).resolveDueAt.toISOString(), '2026-10-29T08:00:00.000Z');
   assert.equal(slaDue('S4', t0).responseDueAt, null);
   assert.equal(slaDue('S3', t0).resolveDueAt.toISOString(), '2026-11-04T08:00:00.000Z');
});

test('SLA state', () => {
   const t = { status: 'open', createdAt: t0, ...slaDue('S1', t0) };
   assert.equal(slaState(t, new Date('2026-10-28T10:00:00Z')), 'on_track');
   assert.equal(slaState(t, new Date('2026-10-29T03:00:00Z')), 'due_soon');
   assert.equal(slaState(t, new Date('2026-10-29T09:00:00Z')), 'overdue');
   assert.equal(slaState({ ...t, status: 'closed', closedAt: new Date('2026-10-28T20:00:00Z') }), 'met');
});

test('status moves and unit rules', () => {
   assert.ok(canMove('open', 'assigned'));
   assert.ok(!canMove('closed', 'open'));
   assert.equal(statusAfterLastTicket(true), 'occupied');
   assert.equal(statusAfterLastTicket(false), 'available');
   assert.ok(blocksUnit('S2') && !blocksUnit('S3'));
});

test('severity suggestion is only a suggestion', () => {
   assert.equal(suggestSeverity('Water leak inside unit'), 'S2');
   assert.equal(suggestSeverity('Customer locked out, cannot open shutter'), 'S1');
   assert.equal(suggestSeverity('paint scratch on door'), 'S4');
   assert.equal(suggestSeverity('light flickering'), 'S3');
});
