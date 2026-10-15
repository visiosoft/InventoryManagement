import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isExitSurveyReply, readExitSurvey, exitSurveySummary, contractIdFromToken, exitSurveyToken, summarise,
} from './exitSurvey.js';

const reply = (data) => ({ interactive: { type: 'nfm_reply', nfm_reply: { response_json: JSON.stringify(data) } } });

test('recognised by our token', () => {
    assert.equal(isExitSurveyReply(reply({ flow_token: 'exit_survey.none.1', reason: 'price' })), true);
});

test('recognised by its answers when the token is not ours', () => {
    assert.equal(isExitSurveyReply(reply({ flow_token: 'x', reason: 'price', rating: '4', come_back: 'yes' })), true);
});

test('another flow (renewal date picker) is not an exit survey', () => {
    assert.equal(isExitSurveyReply(reply({ from_date: '2026-09-20' })), false);
    assert.equal(isExitSurveyReply({ text: { body: 'price' } }), false);
});

test('answers are read and cleaned', () => {
    const a = readExitSurvey(reply({ reason: 'price', rating: '4', come_back: 'maybe', one_change: '  cheaper  ', what_would_keep_you: '' }));
    assert.deepEqual(
        { reason: a.reason, rating: a.rating, comeBack: a.comeBack, oneChange: a.oneChange, whatWouldKeepYou: a.whatWouldKeepYou },
        { reason: 'price', rating: 4, comeBack: 'maybe', oneChange: 'cheaper', whatWouldKeepYou: '' },
    );
    assert.equal(readExitSurvey(reply({ rating: '9' })).rating, null);
});

test('inbox line', () => {
    assert.equal(
        exitSurveySummary(reply({ reason: 'moving_abroad', rating: '5', come_back: 'yes' })),
        'Exit survey · Moving abroad · 5/5 · come back: Yes',
    );
    assert.equal(exitSurveySummary(reply({ from_date: '2026-09-20' })), '');
});

test('token carries the contract id', () => {
    const id = '64b7f0c2a1b2c3d4e5f60718';
    assert.equal(contractIdFromToken(exitSurveyToken(id)), id);
    assert.equal(contractIdFromToken(exitSurveyToken(null)), '');
    assert.equal(contractIdFromToken('noop.123'), '');
});

test('summary totals', () => {
    const s = summarise([
        { reason: 'price', rating: 2, comeBack: 'no' },
        { reason: 'price', rating: 4, comeBack: 'maybe' },
        { reason: 'moving_abroad', rating: null, comeBack: 'yes' },
    ]);
    assert.equal(s.total, 3);
    assert.equal(s.averageRating, 3);
    assert.deepEqual(s.comeBack, { yes: 1, maybe: 1, no: 1 });
    assert.deepEqual(s.byReason[0], { id: 'price', label: 'Price too high', count: 2 });
});

test('token carries the phone for the flow endpoint', async () => {
    const { phoneFromExitToken } = await import('./exitSurvey.js');
    assert.equal(phoneFromExitToken(exitSurveyToken('64b7f0c2a1b2c3d4e5f60718', '+971 50 123 4567')), '971501234567');
    assert.equal(phoneFromExitToken(exitSurveyToken(null)), '');
});
