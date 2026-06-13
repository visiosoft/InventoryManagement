// Payment schedule generation for a contract.
// Weekly: a payment every 7 days from startDate until endDate (exclusive of periods past end).
// Monthly: a payment on the same day-of-month each month.

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Handle short months (e.g. Jan 31 + 1 month → Feb 28)
  if (d.getDate() < day) d.setDate(0);
  return d;
}

export function generateSchedule({ startDate, endDate, billingPeriod, rate, firstPaymentDiscountPct = 0 }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const payments = [];
  let due = new Date(start);
  let i = 0;
  while (due < end && i < 520) {
    const amount = (i === 0 && firstPaymentDiscountPct > 0)
      ? Math.round(rate * (1 - firstPaymentDiscountPct / 100) * 100) / 100
      : rate;
    payments.push({ amount, dueDate: new Date(due), status: 'pending' });
    i += 1;
    due = billingPeriod === 'weekly' ? addDays(start, 7 * i) : addMonths(start, i);
  }
  return payments;
}
