// Shared balance/status recompute so a payment lands the same way whether it
// was recorded manually or landed automatically via a Stripe webhook.
export function applyMovingInvoicePayment(invoice, { amount, method, date, notes, receivedBy }) {
  invoice.paymentHistory.push({
    amount: Number(amount),
    method,
    date: date ? new Date(date) : new Date(),
    notes: notes || '',
    receivedBy: receivedBy || '',
  });
  const totalPaid = invoice.depositPaid + invoice.paymentHistory.reduce((s, p) => s + p.amount, 0);
  invoice.balanceDue = Math.max(0, invoice.total - totalPaid);
  invoice.status = invoice.balanceDue <= 0 ? 'paid' : 'partial';
  return invoice;
}
