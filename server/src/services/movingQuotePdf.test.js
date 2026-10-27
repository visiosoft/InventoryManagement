import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMovingQuotePdf, movingQuotePayUrl } from './movingQuotePdf.js';

const quote = {
   _id: 'q1', quoteNo: 'MVQ-1', quoteDate: '2026-10-27', expiryDate: '2026-10-28',
   customer: { fullName: 'Sara Mokry', phone: '+971 52 564 4113' },
   items: [{ description: 'Packing & Moving', qty: 1, rate: 3500, amount: 3500 }],
};
const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

test('the quote is one page; the terms start on a page of their own', async () => {
   assert.equal(pages(await generateMovingQuotePdf(quote)), 1);
   const withTerms = await generateMovingQuotePdf({ ...quote, termsAndConditions: '1. Scope\n1.1. Something.\n'.repeat(4) });
   assert.equal(pages(withTerms), 2);
});

test('the card button goes through the short pay link, only when a Stripe link exists', async () => {
   assert.equal(movingQuotePayUrl(quote), null);
   assert.equal(movingQuotePayUrl({ ...quote, stripePaymentLinkUrl: 'https://checkout.stripe.com/x' }), 'https://api.purplebox.ae/api/moving-quotes/pay/link/q1');
   const pdf = await generateMovingQuotePdf({ ...quote, stripePaymentLinkUrl: 'https://checkout.stripe.com/x' });
   assert.match(pdf.toString('latin1'), /moving-quotes\/pay\/link\/q1/);
});
