import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFormView, formAnswersFromRaw, formFromRaw } from './flowView.js';

const reply = (data) => ({ interactive: { type: 'nfm_reply', nfm_reply: { response_json: JSON.stringify(data) } } });

test('a submitted welcome form reads field by field', () => {
    const v = formAnswersFromRaw(reply({ flow: 'welcome', flow_token: 'welcome.971', size: '50', start_date: '2026-11-01' }));
    assert.deepEqual(v, { name: 'Welcome form', answers: [
        { label: 'Unit size', value: '50 sq ft' },
        { label: 'Start date', value: '1 Nov 2026' },
    ] });
    assert.equal(formAnswersFromRaw(reply({ flow: 'welcome', size: 'not_sure', start_date: '2026-11-01' })).answers[0].value, 'Not sure');
});

test('other forms: exit survey, booking dates, client details with photos', () => {
    const exit = formAnswersFromRaw(reply({ flow_token: 'exit_survey.x', reason: 'moving_abroad', rating: '4', come_back: 'yes' }));
    assert.equal(exit.name, 'Exit survey');
    assert.deepEqual(exit.answers.map((a) => a.value), ['Moving abroad', '4/5', 'yes']);
    assert.equal(formAnswersFromRaw(reply({ from_date: '2026-11-01', to_date: '2026-12-01' })).name, 'Booking dates');
    const ci = formAnswersFromRaw(reply({ full_name: 'Sara Ali', id_photo: [{ id: 'a' }, { id: 'b' }] }));
    assert.equal(ci.name, 'Client details');
    assert.deepEqual(ci.answers[1], { label: 'ID photo', value: '2 files' });
});

test('a form we sent carries its button; ordinary messages carry nothing', () => {
    assert.deepEqual(formFromRaw({ flowForm: { name: 'Welcome form', cta: 'Choose size' } }), { name: 'Welcome form', cta: 'Choose size' });
    const out = withFormView({ direction: 'outbound', text: 'hi' }, { flowForm: { name: 'Exit survey', cta: 'Give feedback' } });
    assert.equal(out.form.cta, 'Give feedback');
    assert.deepEqual(withFormView({ direction: 'inbound', text: 'hi' }, { text: { body: 'hi' } }), { direction: 'inbound', text: 'hi' });
    assert.equal(formAnswersFromRaw({ interactive: { type: 'nfm_reply', nfm_reply: { response_json: 'nope' } } }), null);
});

test('a template shows its buttons; a Flow button shows as the form', async () => {
    const { withFormView, templatesFor } = await import('./flowView.js');
    process.env.WHATSAPP_WELCOME_FLOW_ID = '123';
    const meta = { name: 'welcome', components: [{ type: 'BODY', text: 'Hi' }, { type: 'BUTTONS', buttons: [
        { type: 'FLOW', text: 'Choose size', flow_id: 123 }, { type: 'QUICK_REPLY', text: 'Call me' }, { type: 'URL', text: 'Website', url: 'https://x' },
    ] }] };
    const msgs = [{ direction: 'outbound', type: 'template', raw: { template: { name: 'welcome' } } }];
    const byName = await templatesFor(msgs, async () => ({ templates: [meta] }));
    const v = withFormView({ direction: 'outbound', type: 'template', text: 'Hi' }, msgs[0].raw, byName);
    assert.deepEqual(v.form, { name: 'Welcome form', cta: 'Choose size' });
    assert.deepEqual(v.buttons, [{ type: 'QUICK_REPLY', text: 'Call me' }, { type: 'URL', text: 'Website' }]);
    assert.equal(await templatesFor([{ direction: 'inbound', type: 'text' }], async () => { throw new Error('not called'); }), null);
});

test('a carousel "Get a quote" tap names the card it came from', () => {
    const out = withFormView({ direction: 'inbound', text: 'Get a quote' }, { button: { text: 'Get a quote', payload: 'pb_card:F2-048' } });
    assert.equal(out.text, 'Get a quote — 10 sq ft unit');
    const already = withFormView({ direction: 'inbound', text: 'Get a quote — 10 sq ft unit' }, { button: { payload: 'pb_card:F2-048' } });
    assert.equal(already.text, 'Get a quote — 10 sq ft unit');
});
