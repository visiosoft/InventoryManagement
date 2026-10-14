import test from 'node:test';
import assert from 'node:assert/strict';
import { isOptOut, windowOpen, phoneKey, customerWritesArabic, templatesForLanguage } from './guards.js';

test('plain opt-out requests are recognised, in English and Arabic', () => {
    for (const t of ['STOP', 'stop.', 'Unsubscribe', "please don't message me", 'do not contact me', 'stop messaging', 'remove me', 'لا ترسل لي', 'توقف', 'احذفني']) {
        assert.equal(isOptOut(t), true, t);
    }
});

test('ordinary messages that contain the word are not opt-outs', () => {
    for (const t of ["please don't stop the offer", 'I will stop by tomorrow', 'can you cancel my site visit and rebook', 'what is the end date', '']) {
        assert.equal(isOptOut(t), false, t);
    }
});

test('the 24h window closes half an hour early', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    assert.equal(windowOpen(new Date('2026-10-14T01:00:00Z'), now), true);
    assert.equal(windowOpen(new Date('2026-10-13T12:10:00Z'), now), false, '23h50 ago is too close');
    assert.equal(windowOpen(null, now), false);
});

test('phone keys are the last nine digits', () => {
    assert.equal(phoneKey('+971 56 942 0950'), '569420950');
    assert.equal(phoneKey('0569420950'), '569420950');
    assert.equal(phoneKey('123'), '');
});

test('language: Arabic writers get Arabic templates, others never do', () => {
    const t = [{ name: 'a', language: 'en' }, { name: 'b', language: 'ar' }];
    assert.deepEqual(templatesForLanguage(t, true).map((x) => x.name), ['b']);
    assert.deepEqual(templatesForLanguage(t, false).map((x) => x.name), ['a']);
    assert.deepEqual(templatesForLanguage([{ name: 'a', language: 'en' }], true).map((x) => x.name), ['a'], 'falls back when none exist');
    assert.equal(customerWritesArabic([{ direction: 'inbound', text: 'مرحبا أريد مخزن' }]), true);
    assert.equal(customerWritesArabic([{ direction: 'inbound', text: 'hello' }]), false);
});
