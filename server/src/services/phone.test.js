import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, phoneTail9 } from './phone.js';

test('UAE numbers typed any way end up in the WhatsApp form', () => {
    for (const typed of ['054 266 2555', '0542662555', '542662555', '+971 54 266 2555', '00971542662555', '+971 054 266 2555', '971542662555']) {
        assert.equal(normalizePhone(typed), '971542662555', typed);
    }
    assert.equal(normalizePhone('04 321 1234'), '97143211234');
});

test('numbers from other countries are left as they are', () => {
    assert.equal(normalizePhone('+966 59 367 5102'), '966593675102');
    assert.equal(normalizePhone('16315551181'), '16315551181');
    assert.equal(normalizePhone('+44 7700 900123'), '447700900123');
});

test('the last nine digits match across formats', () => {
    assert.equal(phoneTail9('054 266 2555'), phoneTail9('971542662555'));
    assert.equal(phoneTail9('123'), '');
});
