import { useQuery } from '@tanstack/react-query'
import { integrationApi } from './api'

/**
 * The one admin-fee switch behind every Stripe payment link — storage and
 * moving, quotes and invoices alike. Every page that offers a payment link
 * reads this to show the fee transparently before anything is sent; the
 * server enforces it independently (see server/src/services/paymentFee.js),
 * so a stale read here never lets a fee slip through or drop silently — it
 * only affects what the page *says* before the request is made.
 */
export function usePaymentFee() {
  return useQuery({
    queryKey: ['payment-fee'],
    queryFn: integrationApi.getPaymentFee,
    staleTime: 60_000,
  })
}

/** How to describe it before sending, given the amount actually owed. */
export function feeBreakdown(amount: number, fee: { enabled: boolean; pct: number } | undefined) {
  if (!fee?.enabled || !(fee.pct > 0) || !(amount > 0)) {
    return { feeAmount: 0, total: amount, line: '' }
  }
  const feeAmount = Math.round(amount * (fee.pct / 100) * 100) / 100
  const total = amount + feeAmount
  return {
    feeAmount, total,
    line: `+ ${fee.pct}% card processing fee (AED ${feeAmount.toLocaleString()}) · customer pays AED ${total.toLocaleString()} total`,
  }
}
