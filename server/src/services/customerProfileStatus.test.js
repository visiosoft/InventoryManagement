import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileCompleteness } from './customerProfileStatus.js';

test('a full file is 100%', () => {
    const c = { fullName: 'Sara K', phone: '+971501234567', email: 's@x.ae', nationality: 'Indian', emergencyNumber: '+971521112222', emiratesId: '784-1990-1234567-1', eidExpiry: new Date() };
    assert.deepEqual(profileCompleteness(c, { hasIdDocument: true }), { pct: 100, done: 8, total: 8, missing: [] });
});

test('a WhatsApp placeholder name does not count, and missing items are named', () => {
    const r = profileCompleteness({ fullName: 'WhatsApp Contact 4567', phone: '+971501234567' });
    assert.equal(r.pct, 13);
    assert.deepEqual(r.missing, ['name', 'email', 'nationality', 'emergency contact', 'ID number', 'ID expiry', 'ID document']);
});

test('a passport counts as the ID', () => {
    const r = profileCompleteness({ fullName: 'Sara', passportNumber: 'N123', passportExpiry: new Date() }, { hasIdDocument: true });
    assert.ok(!r.missing.includes('ID number') && !r.missing.includes('ID expiry') && !r.missing.includes('ID document'));
});
