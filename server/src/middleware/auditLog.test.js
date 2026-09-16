import test from 'node:test';
import assert from 'node:assert/strict';
import { entityLabelFor, parseAuditTarget, actorFrom } from './auditLog.js';

const ID_A = '507f1f77bcf86cd799439011';
const ID_B = '507f1f77bcf86cd799439022';

test('entityLabelFor uses the known map, and title-cases anything unmapped', () => {
  assert.equal(entityLabelFor('moving-jobs'), 'MovingJob');
  assert.equal(entityLabelFor('contracts'), 'Contracts', 'unmapped segments still get logged, just title-cased');
  assert.equal(entityLabelFor('some-new-module'), 'SomeNewModule');
});

test('POST to a collection root is "created"', () => {
  const r = parseAuditTarget('POST', ['contracts']);
  assert.equal(r.action, 'created');
  assert.equal(r.entityId, '');
});

test('PUT/PATCH straight to :id is "updated"', () => {
  assert.equal(parseAuditTarget('PUT', ['contracts', ID_A]).action, 'updated');
  assert.equal(parseAuditTarget('PATCH', ['moving-jobs', ID_A]).action, 'updated');
});

test('DELETE is always "deleted", regardless of path shape', () => {
  assert.equal(parseAuditTarget('DELETE', ['contracts', ID_A]).action, 'deleted');
  assert.equal(parseAuditTarget('DELETE', ['tasks', ID_A, 'comments', ID_B]).action, 'deleted');
});

test('a trailing verb becomes the action, not "created"/"updated"', () => {
  assert.equal(parseAuditTarget('POST', ['contracts', ID_A, 'archive']).action, 'archive');
  assert.equal(parseAuditTarget('PATCH', ['moving-invoices', ID_A, 'status']).action, 'updated (status)');
});

test('a bulk action with no id in the path still gets its own action name', () => {
  const r = parseAuditTarget('POST', ['contracts', 'bulk-delete']);
  assert.equal(r.action, 'bulk-delete');
  assert.equal(r.entityId, '');
});

test('a nested sub-resource reports the LAST id-shaped segment, not the parent', () => {
  const r = parseAuditTarget('DELETE', ['moving-jobs', ID_A, 'visits', ID_B]);
  assert.equal(r.entity, 'MovingJob');
  assert.equal(r.entityId, ID_B, 'the visit being deleted, not the parent job');
});

test('actorFrom prefers staff, then customer portal, then crew, then Public', () => {
  assert.deepEqual(actorFrom({ user: { id: 'u1', name: 'Jane', email: 'jane@x.com' } }), { user: 'u1', userName: 'Jane', userEmail: 'jane@x.com' });
  assert.equal(actorFrom({ customer: { phone: '+97150...' } }).userName, 'Customer +97150...');
  assert.equal(actorFrom({ crewId: 'c1' }).userName, 'Crew member c1');
  assert.equal(actorFrom({}).userName, 'Public');
});
