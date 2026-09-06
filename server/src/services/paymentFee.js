import { PaymentFeeConfig } from '../models/index.js';

/**
 * The one on/off switch and percentage behind every payment link the system
 * creates — storage and moving, quotes and invoices alike. One Stripe
 * account, one fee: a customer should not see 3% on an invoice and a
 * different number on a quote from the same company.
 *
 * Off by default. Every route that creates a Stripe Checkout session calls
 * `resolveFeePct()` rather than trusting anything a client sends — so
 * switching this off in Settings genuinely stops the fee everywhere at once,
 * not just on whichever screen happens to check it.
 */

export async function getPaymentFeeConfig() {
  let config = await PaymentFeeConfig.findOne();
  if (!config) config = await PaymentFeeConfig.create({});
  return config;
}

/** The fee percentage to actually charge right now — 0 when the switch is off,
 *  whatever an individual route asks for notwithstanding. */
export async function resolveFeePct() {
  const config = await getPaymentFeeConfig();
  return config.enabled ? Number(config.pct) || 0 : 0;
}
