/**
 * Reading a Meta webhook payload, run with `node --test`.
 *
 * The inbound/outbound decision is what puts a message on the correct side of
 * the conversation, so it is pinned here rather than left to be discovered in
 * a live thread.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMessagesFromPayload } from './whatsappLeadSync.js';

const OUR_NUMBER = '971542249946';
const CUSTOMER = '971501317160';

const payload = (value) => ({
    entry: [{
        changes: [{
            field: 'messages',
            value: { messaging_product: 'whatsapp', metadata: { display_phone_number: OUR_NUMBER }, ...value },
        }],
    }],
});

const inbound = {
    from: CUSTOMER, id: 'wamid.IN1', type: 'text',
    timestamp: '1755700000', text: { body: 'Do you have a 50 sqft unit?' },
};

const echo = {
    to: CUSTOMER, from: OUR_NUMBER, id: 'wamid.ECHO1', type: 'text',
    timestamp: '1755700100', text: { body: 'Yes, from AED 980 a month.' },
};

test('a customer message is inbound, keyed to the customer', () => {
    const [m] = extractMessagesFromPayload(payload({ messages: [inbound] }));
    assert.equal(m.direction, 'inbound');
    assert.equal(m.phoneNormalized, CUSTOMER);
    assert.equal(m.text, 'Do you have a 50 sqft unit?');
});

test('an echo is outbound, and still keyed to the customer', () => {
    // The thread belongs to the customer whichever way the message went, so an
    // echo must file under `to`, never under our own number.
    for (const key of ['message_echoes', 'smb_message_echoes']) {
        const [m] = extractMessagesFromPayload(payload({ [key]: [echo] }));
        assert.equal(m.direction, 'outbound', key);
        assert.equal(m.phoneNormalized, CUSTOMER, key);
        assert.equal(m.status, 'sent', key);
        assert.equal(m.text, 'Yes, from AED 980 a month.', key);
    }
});

test('an echo delivered inside `messages` is still recognised as outbound', () => {
    // Some Coexistence setups do not use a separate field. Our own number in
    // `from` is what settles it.
    const [m] = extractMessagesFromPayload(payload({ messages: [echo] }));
    assert.equal(m.direction, 'outbound');
    assert.equal(m.phoneNormalized, CUSTOMER);
});

test('inbound and echoes in one payload both come through', () => {
    const out = extractMessagesFromPayload(payload({ messages: [inbound], message_echoes: [echo] }));
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((m) => m.direction).sort(), ['inbound', 'outbound']);
    assert.deepEqual([...new Set(out.map((m) => m.phoneNormalized))], [CUSTOMER]);
});

test('delivery receipts stay separate from messages', () => {
    const out = extractMessagesFromPayload(payload({
        statuses: [{ recipient_id: CUSTOMER, id: 'wamid.ECHO1', status: 'read', timestamp: '1755700200' }],
    }));
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'status');
    assert.equal(out[0].status, 'read');
});

test('media echoes carry their type', () => {
    const [m] = extractMessagesFromPayload(payload({
        message_echoes: [{ to: CUSTOMER, from: OUR_NUMBER, id: 'wamid.E2', type: 'image', timestamp: '1755700300', image: { id: '123' } }],
    }));
    assert.equal(m.direction, 'outbound');
    assert.equal(m.type, 'image');
});

test('a message with no usable number is dropped rather than stored blank', () => {
    assert.equal(extractMessagesFromPayload(payload({ messages: [{ id: 'x', type: 'text', from: '' }] })).length, 0);
});

test('an edit carries the new text and the message it replaces', () => {
    const [m] = extractMessagesFromPayload(payload({
        messages: [{
            from: CUSTOMER, id: 'wamid.E', type: 'edit', timestamp: '1755700400',
            edit: { original_message_id: 'wamid.IN1', message: { type: 'text', text: { body: 'Actually, 75 sqft' } } },
        }],
    }));
    assert.equal(m.type, 'edit');
    assert.equal(m.targetMessageId, 'wamid.IN1');
    assert.equal(m.text, 'Actually, 75 sqft');
});

test('a deletion names the message it removes', () => {
    const [m] = extractMessagesFromPayload(payload({
        messages: [{
            from: CUSTOMER, id: 'wamid.R', type: 'revoke', timestamp: '1755700500',
            revoke: { original_message_id: 'wamid.IN1' },
        }],
    }));
    assert.equal(m.type, 'revoke');
    assert.equal(m.targetMessageId, 'wamid.IN1');
});

test('a reaction carries its emoji and target, and an empty one means removed', () => {
    const react = (emoji) => extractMessagesFromPayload(payload({
        messages: [{
            from: CUSTOMER, id: 'wamid.K', type: 'reaction', timestamp: '1755700600',
            reaction: { message_id: 'wamid.IN1', emoji },
        }],
    }))[0];
    const thumbsUp = '\u{1F44D}';
    assert.equal(react(thumbsUp).text, thumbsUp);
    assert.equal(react(thumbsUp).targetMessageId, 'wamid.IN1');
    assert.equal(react('').text, '');
});

test('an empty payload yields nothing', () => {
    assert.deepEqual(extractMessagesFromPayload({}), []);
    assert.deepEqual(extractMessagesFromPayload(payload({})), []);
});
