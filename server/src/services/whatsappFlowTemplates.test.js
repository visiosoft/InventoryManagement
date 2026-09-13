import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPlaceholders, defaultFlowTemplateSteps, DEFAULT_HANDOFF_TEXT, DEFAULT_COMPLETION_TEXT } from './whatsappFlowTemplates.js';

test('fillPlaceholders substitutes every token it has a value for', () => {
    assert.equal(
        fillPlaceholders('Unit {unitNumber} ({size} sqft) is {price}', { unitNumber: 'F2-64', size: '25', price: 'AED 600/month' }),
        'Unit F2-64 (25 sqft) is AED 600/month'
    );
});

test('a token with no matching var drops out rather than showing literally', () => {
    assert.equal(fillPlaceholders('Hi {name}, your unit is ready'), 'Hi , your unit is ready');
});

test('an empty-string value also drops out, same as a missing one', () => {
    assert.equal(fillPlaceholders('{greeting}Welcome', { greeting: '' }), 'Welcome');
});

test('blank input never throws and returns a blank string', () => {
    assert.equal(fillPlaceholders(''), '');
    assert.equal(fillPlaceholders(undefined), '');
    assert.equal(fillPlaceholders(null), '');
});

test('the seeded template has the same five-step shape movingStorageFlow.js expects', () => {
    const steps = defaultFlowTemplateSteps();
    assert.deepEqual(steps.map((s) => s.kind), ['buttons', 'size_list', 'date_range', 'text_question', 'text_question']);
    assert.equal(steps[0].options.length, 2);
    assert.equal(steps[0].options[1].action, 'next'); // Storage continues; Moving (options[0]) hands off
    assert.equal(steps[0].options[0].action, 'handoff');
    assert.equal(steps[3].saveField, 'fullName');
    assert.equal(steps[4].saveField, 'contactPhone');
});

test('the default handoff and completion text are non-empty, real sentences', () => {
    assert.match(DEFAULT_HANDOFF_TEXT, /team will follow up/);
    assert.match(DEFAULT_COMPLETION_TEXT, /\{name\}/);
});
