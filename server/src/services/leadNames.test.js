import test from 'node:test';
import assert from 'node:assert/strict';
import { promotePlaceholderName } from './leadNames.js';

test('placeholder becomes the WhatsApp profile name', () => {
    const l = { fullName: 'WhatsApp Contact 4387', whatsappProfileName: ' Sara Khan ' };
    assert.equal(promotePlaceholderName(l), true);
    assert.equal(l.fullName, 'Sara Khan');
});
test('typed names and missing profile names are left alone', () => {
    const typed = { fullName: 'Omar', whatsappProfileName: 'Sara' };
    assert.equal(promotePlaceholderName(typed), false);
    assert.equal(typed.fullName, 'Omar');
    const none = { fullName: 'WhatsApp Contact 1', whatsappProfileName: '' };
    assert.equal(promotePlaceholderName(none), false);
    assert.equal(none.fullName, 'WhatsApp Contact 1');
});
