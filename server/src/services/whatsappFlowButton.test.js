import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '111';
process.env.WHATSAPP_WABA_ID = '222';

const { sendWhatsAppTemplate } = await import('./whatsapp.js');

test('a template with a Flow button gets the button parameter at its own index', async () => {
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
        if (String(url).includes('/message_templates')) {
            return new Response(JSON.stringify({ data: [{
                name: 'feedback_survey_1', language: 'en', status: 'APPROVED', category: 'UTILITY',
                components: [
                    { type: 'BODY', text: 'Thank you for storing with PurpleBox!' },
                    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Later' }, { type: 'FLOW', text: 'Share feedback', flow_id: 999, navigate_screen: 'OTHER' }] },
                ],
            }] }), { status: 200 });
        }
        sent.push(JSON.parse(opts.body));
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    };
    try {
        await sendWhatsAppTemplate({ to: '971501234567', name: 'feedback_survey_1', language: 'en' });
    } finally {
        globalThis.fetch = realFetch;
    }
    const button = sent[0].template.components.find((c) => c.type === 'button');
    assert.equal(button.sub_type, 'flow');
    assert.equal(button.index, '1');
    assert.match(button.parameters[0].action.flow_token, /^flow\./);
});
