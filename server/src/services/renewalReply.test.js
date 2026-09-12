import test from 'node:test';
import assert from 'node:assert/strict';
import { buttonReplyText, isButtonReply, readAnswer, interactiveReplyId, isFlowReply, flowReplyData } from './renewalReply.js';

/**
 * Reading a Yes/No tap on the contract-expiry template.
 *
 * The shapes below are Meta's, and the reason this needs testing is that none
 * of them carry `text.body` — which is why every button tap was being stored as
 * a blank message before any of this existed.
 */

test("a template's quick reply is read from button.text", () => {
    // What the contract_expiry_notification template's Yes button sends.
    const raw = { type: 'button', button: { text: 'Yes', payload: 'Yes' }, from: '971500000000' };
    assert.equal(buttonReplyText(raw), 'Yes');
    assert.equal(isButtonReply(raw, 'button'), true);
});

test('an interactive button reply is read from its title', () => {
    const raw = { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'renew_yes', title: 'Yes' } } };
    assert.equal(buttonReplyText(raw), 'Yes');
    assert.equal(isButtonReply(raw, 'interactive'), true);
});

test('a list pick is read too', () => {
    const raw = { interactive: { type: 'list_reply', list_reply: { id: 'r12', title: 'Renew' } } };
    assert.equal(buttonReplyText(raw), 'Renew');
});

test('a submitted WhatsApp Flow is recognised as its own kind of reply, not a button tap', () => {
    const raw = { interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{"from_date":"2026-09-20"}' } } };
    assert.equal(isFlowReply(raw), true);
    assert.equal(isButtonReply(raw, 'interactive'), false);
});

test("a flow's answers are parsed out of Meta's JSON-in-a-string field", () => {
    const raw = { interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{"from_date":"2026-09-20","to_date":"2026-12-20"}' } } };
    assert.deepEqual(flowReplyData(raw), { from_date: '2026-09-20', to_date: '2026-12-20' });
});

test('a missing or unparsable flow response reads as empty, not a thrown error', () => {
    assert.deepEqual(flowReplyData({ interactive: { type: 'nfm_reply' } }), {});
    assert.deepEqual(flowReplyData({ interactive: { type: 'nfm_reply', nfm_reply: { response_json: 'not json' } } }), {});
    assert.deepEqual(flowReplyData({}), {});
});

test('the payload is used when a button carries no text', () => {
    assert.equal(buttonReplyText({ button: { payload: 'Yes' } }), 'Yes');
});

test('an ordinary text message is not a button', () => {
    const raw = { type: 'text', text: { body: 'yes' } };
    assert.equal(buttonReplyText(raw), '');
    assert.equal(isButtonReply(raw, 'text'), false);
});

test('a typed "yes" must never be treated as a tap', () => {
    /* The case this guards: the assistant asks "shall I book you a viewing?",
       the customer types yes, and they get a renewal link instead of an answer.
       A button carries context that a bare word does not. */
    assert.equal(isButtonReply({ type: 'text', text: { body: 'yes' } }, 'text'), false);
});

test('yes and no are recognised, in the words the buttons actually use', () => {
    assert.equal(readAnswer('Yes'), 'renewing');
    assert.equal(readAnswer('yes'), 'renewing');
    assert.equal(readAnswer('Renew'), 'renewing');
    assert.equal(readAnswer('نعم'), 'renewing');
    assert.equal(readAnswer('No'), 'not_renewing');
    assert.equal(readAnswer('no thanks'), 'not_renewing');
    assert.equal(readAnswer('Moving out'), 'not_renewing');
});

test('an unrecognised button is left alone rather than guessed at', () => {
    // Another template's buttons must not be read as a renewal answer.
    assert.equal(readAnswer('Call me back'), '');
    assert.equal(readAnswer('See prices'), '');
    assert.equal(readAnswer(''), '');
});

test('"no" is never mistaken for "yes" by a loose match', () => {
    // A substring match would make "not renewing" contain "renew".
    assert.equal(readAnswer('not renewing'), 'not_renewing');
    assert.notEqual(readAnswer('not renewing'), 'renewing');
});

test('interactiveReplyId reads the id an id-driven flow branches on, not the title', () => {
    // Unlike buttonReplyText, this must prefer the id even when a title is
    // also present — a menu's wording can change (or be translated) without
    // breaking what it branches on.
    assert.equal(
        interactiveReplyId({ interactive: { button_reply: { id: 'svc_storage', title: 'Storage' } } }),
        'svc_storage',
    );
    assert.equal(
        interactiveReplyId({ interactive: { list_reply: { id: 'size_35', title: '35 sqft' } } }),
        'size_35',
    );
});

test('interactiveReplyId is empty for anything that is not an interactive reply', () => {
    assert.equal(interactiveReplyId({ type: 'text', text: { body: 'hi' } }), '');
    assert.equal(interactiveReplyId({ type: 'button', button: { text: 'Yes' } }), '');
    assert.equal(interactiveReplyId(null), '');
});

test('rubbish input does not throw', () => {
    assert.equal(buttonReplyText(null), '');
    assert.equal(buttonReplyText(undefined), '');
    assert.equal(buttonReplyText('a string'), '');
    assert.equal(isButtonReply(null, 'text'), false);
});
