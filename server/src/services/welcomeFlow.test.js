import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isWelcomeReply, readWelcome, welcomeSummary, thankYouText, dubaiToday } from './welcomeFlow.js';

const reply = (data) => ({ interactive: { type: 'nfm_reply', nfm_reply: { response_json: JSON.stringify(data) } } });

test('recognised by its own marker, and not confused with the dates flow', () => {
    assert.equal(isWelcomeReply(reply({ flow: 'welcome', size: '50', start_date: '2026-11-01' })), true);
    assert.equal(isWelcomeReply(reply({ flow_token: 'welcome.97150', size: '50', start_date: '2026-11-01' })), true);
    assert.equal(isWelcomeReply(reply({ from_date: '2026-11-01', to_date: '2026-12-01' })), false);
    assert.equal(isWelcomeReply({ text: { body: '50' } }), false);
});

test('answers are read into lead values', () => {
    const a = readWelcome(reply({ flow: 'welcome', size: '35', start_date: '2026-11-01' }));
    assert.equal(a.size, 35);
    assert.equal(a.startDate.toISOString(), '2026-10-31T20:00:00.000Z');   // Dubai midnight
    assert.equal(readWelcome(reply({ flow: 'welcome', size: 'not_sure', start_date: '' })).size, -1);
    assert.equal(readWelcome(reply({ flow: 'welcome', size: 'abc', start_date: 'x' })).size, null);
});

test('inbox line and thank-you', () => {
    assert.equal(welcomeSummary(reply({ flow: 'welcome', size: '50', start_date: '2026-11-01' })), 'Welcome form · 50 sq ft · from 1 Nov 2026');
    assert.match(thankYouText({ size: 50, startDate: new Date('2026-10-31T20:00:00Z') }), /a 50 sq ft unit from 1 Nov 2026/);
    assert.match(thankYouText({ size: -1, startDate: null }), /help choosing the right size\./);
});

test('the flow JSON offers every size and hands both answers back', () => {
    const flow = JSON.parse(readFileSync(new URL('../../../docs/whatsapp-flows/welcome-size-date.json', import.meta.url)));
    const radios = flow.screens[0].layout.children.find((c) => c.type === 'RadioButtonsGroup');
    assert.deepEqual(radios['data-source'].map((o) => o.id).slice(0, 4), ['10', '25', '35', '40']);
    assert.ok(radios['data-source'].every((o) => o.title.length <= 30));
    const done = flow.screens[1].layout.children.find((c) => c.type === 'Footer')['on-click-action'];
    assert.deepEqual(Object.keys(done.payload), ['flow', 'size', 'start_date']);
    assert.match(dubaiToday(new Date('2026-10-16T21:00:00Z')), /^2026-10-17$/);
});
