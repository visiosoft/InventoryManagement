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
    assert.match(thankYouText({ size: -1, startDate: null }), /https:\/\/purplebox\.ae\/estimator\.html/);
});

test('the flow JSON offers every size and hands both answers back', () => {
    const flow = JSON.parse(readFileSync(new URL('../../../docs/whatsapp-flows/welcome-size-date.json', import.meta.url)));
    const radios = flow.screens[0].layout.children.find((c) => c.type === 'RadioButtonsGroup');
    assert.deepEqual(radios['data-source'].map((o) => o.id), ['10', '25', '35', '50', '75', '100', '150', '200', 'not_sure']);
    assert.ok(radios['data-source'].every((o) => o.title.length <= 30));
    const done = flow.screens.find((x) => x.id === 'START_DATE').layout.children.find((c) => c.type === 'Footer')['on-click-action'];
    assert.deepEqual(Object.keys(done.payload), ['flow', 'size', 'start_date', 'via']);
    assert.match(dubaiToday(new Date('2026-10-16T21:00:00Z')), /^2026-10-17$/);
});

test('"Not sure" goes to the estimator screen; the size picked there reaches sales with the date', async () => {
    const flow = JSON.parse(readFileSync(new URL('../../../docs/whatsapp-flows/welcome-size-date.json', import.meta.url)));
    const size = flow.screens.find((s) => s.id === 'SIZE');
    const branch = size.layout.children.find((c) => c.type === 'If');
    assert.equal(branch.condition, "${form.size} == 'not_sure'");
    assert.equal(branch.then[0]['on-click-action'].next.name, 'ESTIMATOR');
    assert.equal(branch.else[0]['on-click-action'].next.name, 'START_DATE');
    const est = flow.screens.find((s) => s.id === 'ESTIMATOR');
    assert.ok(est.layout.children.some((c) => c.type === 'EmbeddedLink' && c['on-click-action'].url === 'https://purplebox.ae/estimator.html'));
    assert.equal(est.layout.children.find((c) => c.type === 'Footer')['on-click-action'].payload.via, 'estimator');
    const done = flow.screens.find((s) => s.id === 'START_DATE').layout.children.find((c) => c.type === 'Footer')['on-click-action'].payload;
    assert.deepEqual(Object.keys(done), ['flow', 'size', 'start_date', 'via']);

    const r = reply({ flow: 'welcome', size: '75', start_date: '2026-11-01', via: 'estimator' });
    assert.equal(welcomeSummary(r), 'Welcome form · 75 sq ft (via size estimator) · from 1 Nov 2026');
    assert.match(thankYouText({ size: -1, startDate: null, viaEstimator: true }), /help you choose/);
    assert.doesNotMatch(thankYouText({ size: -1, startDate: null, viaEstimator: true }), /estimator\.html/);
});
