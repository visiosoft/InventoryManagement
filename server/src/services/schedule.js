// Payment schedule generation.
// `rate` is the MONTHLY price (4 weeks). Billing is always weekly (payment every 7 days).
// Each weekly payment = rate / 4. No proration — any leftover day = one more full week.
// Discount applies to first 4 weekly payments (= first month).

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function generateSchedule({ startDate, endDate, billingPeriod, rate, firstPaymentDiscountPct = 0 }) {
  const start         = new Date(startDate);
  const end           = new Date(endDate);
  const daysPerPeriod = billingPeriod === 'weekly' ? 7 : 28;
  const totalDays     = Math.round((end.getTime() - start.getTime()) / 86400000);
  // Ceiling: any leftover day = one more full-rate period
  const totalPeriods  = Math.ceil(totalDays / daysPerPeriod);
  // First month = 4 weekly periods (or 1 monthly period)
  const discountPeriods = daysPerPeriod === 7 ? 4 : 1;
  // Weekly payment = monthly rate ÷ 4 (for monthly billing it stays as-is)
  const periodRate    = billingPeriod === 'weekly' ? rate / 4 : rate;

  const payments = [];
  for (let i = 0; i < totalPeriods; i++) {
    const dueDate    = addDays(start, daysPerPeriod * i);
    const discounted = i < discountPeriods && firstPaymentDiscountPct > 0;
    const amount     = discounted
      ? Math.round(periodRate * (1 - firstPaymentDiscountPct / 100) * 100) / 100
      : Math.round(periodRate * 100) / 100;
    payments.push({ amount, dueDate, status: 'pending' });
  }

  return payments;
}
