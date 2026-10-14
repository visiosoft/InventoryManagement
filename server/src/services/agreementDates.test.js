import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshAgreementDates } from './agreementText.js';

test('saved agreement wording follows a moved check-out and check-in', () => {
  const text = 'From 25 June 2026 to 12 November 2026 for unit F2-13. Ends 12 November 2026.';
  const out = refreshAgreementDates(text, { startDate: '2026-06-25', endDate: '2026-11-12' }, { startDate: '2026-06-25', endDate: '2026-12-10' });
  assert.equal(out, 'From 25 June 2026 to 10 December 2026 for unit F2-13. Ends 10 December 2026.');
});
test('nothing changes when the dates did not move or there is no saved wording', () => {
  assert.equal(refreshAgreementDates('Ends 12 November 2026', { endDate: '2026-11-12' }, { endDate: '2026-11-12' }), 'Ends 12 November 2026');
  assert.equal(refreshAgreementDates('', { endDate: '2026-11-12' }, { endDate: '2026-12-10' }), '');
});
