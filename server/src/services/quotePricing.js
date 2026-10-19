import { Invoice, Payment, nextInvoiceNo } from '../models/index.js';
import { isRefundableRow, vatBase, vatOn } from './quoteVat.js';

/**
 * Quote pricing and the first invoice a quote produces — shared by the staff
 * quote routes and the customer app's self-serve booking, so both charge the
 * same figure. Moved here unchanged from routes/quotes.js.
 */

export function toNumber(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}

function mapItem(item, idx) {
    const quantity = toNumber(item.quantity);
    const rate = toNumber(item.rate);
    const discountPct = toNumber(item.discountPct);
    const gross = quantity * rate;
    const amount = Number((gross - (gross * discountPct) / 100).toFixed(2));
    return {
        sortOrder: toNumber(item.sortOrder, idx),
        itemDetails: String(item.itemDetails || '').trim(),
        quantity,
        rate,
        discountPct,
        amount,
    };
}

function calcUnitPeriodTotal(rate, discountPct, startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const days = Math.round((endDate - startDate) / 86400000);
    if (days <= 0) return 0;
    const totalWeeks = Math.ceil(days / 7);
    const weeklyFull = rate / 4;
    const weeklyDisc = weeklyFull - (weeklyFull * discountPct) / 100;
    const discWeeks = Math.min(4, totalWeeks);
    const fullWeeks = Math.max(0, totalWeeks - 4);
    return Math.round((discWeeks * weeklyDisc + fullWeeks * weeklyFull) * 100) / 100;
}

function calcUnitAdvance(rate, startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const days = Math.round((endDate - startDate) / 86400000);
    if (days <= 0) return 0;
    const weeks = Math.ceil(days / 7);
    const advWeeks = weeks % 4 === 0 ? 4 : weeks % 4;
    return Math.round((rate / 4) * advWeeks * 100) / 100;
}

function isShortTerm(startDate, endDate) {
    if (!startDate || !endDate) return false;
    const days = Math.round((endDate - startDate) / 86400000);
    return days > 0 && Math.ceil(days / 7) <= 4;
}

function mapUnit(u) {
    const rate = toNumber(u.rate);
    const discountPct = toNumber(u.discountPct);
    const startDate = u.startDate ? new Date(u.startDate) : null;
    const endDate = u.endDate ? new Date(u.endDate) : null;
    const amount = calcUnitPeriodTotal(rate, discountPct, startDate, endDate);
    return {
        unit: String(u.unit || ''),
        unitNumber: String(u.unitNumber || ''),
        sizeSqf: toNumber(u.sizeSqf),
        floor: String(u.floor || ''),
        startDate,
        endDate,
        rate,
        discountPct,
        amount,
    };
}

function mapAddOn(a) {
    const quantity = toNumber(a.quantity, 1);
    const rate = toNumber(a.rate);
    return {
        name: String(a.name || '').trim(),
        description: String(a.description || '').trim(),
        quantity,
        rate,
        amount: Number((quantity * rate).toFixed(2)),
    };
}

export function normalizeBody(body, { holdAdvance = true } = {}) {
    const items = (Array.isArray(body.items) ? body.items : [])
        .map((it, idx) => mapItem(it, idx))
        .filter((it) => it.itemDetails && it.quantity >= 0 && it.rate >= 0);

    const units = (Array.isArray(body.units) ? body.units : [])
        .map(mapUnit)
        .filter((u) => u.unit && u.startDate && u.endDate);

    const addOns = (Array.isArray(body.addOns) ? body.addOns : [])
        .map(mapAddOn)
        .filter((a) => a.name);

    const unitsTotal = units.reduce((s, u) => s + u.amount, 0);
    const addOnsTotal = addOns.reduce((s, a) => s + a.amount, 0);
    const itemsTotal = items.reduce((s, it) => s + it.amount, 0);
    const subTotal = Number((unitsTotal + addOnsTotal + itemsTotal).toFixed(2));
    const adjustment = toNumber(body.adjustment, 0);
    const deposit = toNumber(body.deposit, 0);

    // The server owns the total — client-sent totals are ignored so every edit
    // path yields the same figure. Rule: rent + add-ons/items + the refundable
    // advance + security deposit, both held on top of the rent on every term.
    //
    // The advance used to be counted only on terms of 4 weeks or less, on the
    // reasoning that a longer term's advance prepays the final period and is
    // therefore already inside unitsTotal. The first invoice does not work that
    // way - it collects four weeks whatever the term - so a year-long quote
    // totalled 18,732 and was then invoiced 1,480 more. Same rule as the
    // invoice now: four weeks, or the whole term if it is shorter, undiscounted.
    const advanceExtra = !holdAdvance ? 0 : units.reduce((sum, u) => {
        const days = Math.round((u.endDate - u.startDate) / 86400000);
        const tw = Math.max(1, Math.ceil(days / 7));
        return sum + (u.rate / 4) * Math.min(4, tw);
    }, 0);
    /* VAT on the supply only.
     *
     * The security deposit and the refundable advance are money held and
     * handed back, not something sold, so they sit outside the tax base —
     * charging on them would bill the customer 5% of a sum they are owed.
     * Absent from an older quote's body means on, which is the standing rule. */
    const vatEnabled = body.vatEnabled === undefined ? true : Boolean(body.vatEnabled);
    const vatRate = vatEnabled ? 5 : 0;
    /* Same on/off-on-the-document idea as VAT above — decided per quote, not
     * from a site-wide switch. Kept out of `total` below: it only applies if
     * the customer actually pays by Stripe card. */
    const cardFeeEnabled = Boolean(body.cardFeeEnabled);
    const cardFeePctRaw = toNumber(body.cardFeePct, 3);
    const cardFeePct = Math.min(15, Math.max(0, cardFeePctRaw));
    /* Charged on the sale, which is not the same as the sub total: an add-on
       or line item named as refundable is money held, not sold, and taxing it
       bills the customer 5% of what they are owed. Two live quotes carry an
       add-on called "Refundable Deposit". services/quoteVat.js holds the rule,
       and the printed quotation applies the same one. */
    const vatAmount = vatOn(vatBase({ unitsTotal, addOns, items, adjustment }), vatRate);

    const total = Number((subTotal + adjustment + vatAmount + advanceExtra + deposit).toFixed(2));

    return {
        quoteDate: body.quoteDate ? new Date(body.quoteDate) : new Date(),
        creationDate: body.creationDate ? new Date(body.creationDate) : new Date(),
        salesperson: String(body.salesperson || ''),
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        pdfTemplate: String(body.pdfTemplate || 'Standard Template'),
        customer: String(body.customer || ''),
        lead: body.lead ? String(body.lead) : undefined,
        billingPeriod: ['weekly', 'monthly'].includes(body.billingPeriod) ? body.billingPeriod : 'monthly',
        billingAddress: String(body.billingAddress || ''),
        shippingAddress: String(body.shippingAddress || ''),
        subject: String(body.subject || ''),
        items,
        units,
        addOns,
        deposit,
        holdAdvance,
        subTotal,
        adjustment,
        vatEnabled,
        vatRate,
        vatAmount,
        cardFeeEnabled,
        cardFeePct,
        total,
        notes: String(body.notes || ''),
        /* Undefined leaves the schema default in place on a new quote and the
           stored copy in place on an existing one — only an explicit value
           changes them, so a save that does not mention terms never quietly
           blanks the ones a customer was sent. */
        ...(body.termsAndConditions !== undefined
            ? { termsAndConditions: String(body.termsAndConditions || '') }
            : {}),
        status: String(body.status || 'draft'),
    };
}

// First invoice for a quote-sourced contract, created as DRAFT with prices locked
// from the quote: first 4-week period per unit + one-time add-ons + deposit.
/** What the first invoice will say, worked out from the quote alone (no records written). */
export function buildFirstInvoice(quote) {
    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const items = [];
    let advanceTotal = 0;

    for (const u of quote.units) {
        const rate = toNumber(u.rate);
        const discountPct = toNumber(u.discountPct);
        const discounted = Number((rate - (rate * discountPct) / 100).toFixed(2));

        // Compute actual period weeks
        const periodStart = new Date(u.startDate);
        const periodEnd = new Date(u.endDate);
        const days = Math.round((periodEnd - periodStart) / 86400000);
        const weeklyRate = Number((discounted / 4).toFixed(2));
        const fullMonths = Math.floor(days / 28);
        const rem = days % 28;
        const extraWeeks = rem > 0 ? Math.ceil(rem / 7) : 0;
        const totalWeeks = fullMonths * 4 + extraWeeks;
        const tw = totalWeeks || 1;

        // First invoice bills only the FIRST period (up to 4 weeks). Later
        // months are invoiced per period ("Add next period"), and the advance
        // deposit covers the final period.
        const firstWeeks = Math.min(4, tw);
        const rentAmount = Number((weeklyRate * firstWeeks).toFixed(2));
        const firstPeriodEnd = new Date(periodStart);
        firstPeriodEnd.setDate(firstPeriodEnd.getDate() + firstWeeks * 7);
        const displayEnd = new Date(Math.min(firstPeriodEnd.getTime(), periodEnd.getTime()));
        displayEnd.setDate(displayEnd.getDate() - 1);
        const wkRate = Number((rate / 4).toFixed(2));
        items.push({
            sortOrder: items.length,
            itemDetails: `Storage Rent ${fmt(periodStart)} – ${fmt(displayEnd)} · Unit ${u.unitNumber}`,
            quantity: firstWeeks,
            rate: wkRate,
            discountPct,
            amount: rentAmount,
        });

        // Skipped entirely when the quote opts out of holding the advance
        if (quote.holdAdvance === false) continue;

        // Advance covers the FINAL rental period, so its length is whatever the
        // term leaves over after the whole 4-week periods (a 6-week term runs
        // 4 + 2, so the advance is 2 weeks — not 4). For terms of 4 weeks or
        // Advance/security deposit = always 4 weeks, adjusted in the last 4 weeks
        const advWeeks = Math.min(4, tw);
        const advAmount = Number((wkRate * advWeeks).toFixed(2));
        const isShortTerm = tw <= 4;
        advanceTotal += advAmount;

        // Label the advance with the period it prepays (the last one)
        const advStart = new Date(periodEnd);
        advStart.setDate(advStart.getDate() - advWeeks * 7);
        const advEnd = new Date(periodEnd);
        advEnd.setDate(advEnd.getDate() - 1);
        items.push({
            sortOrder: items.length,
            itemDetails: isShortTerm
                ? `Refundable Advance · Unit ${u.unitNumber}`
                : `Advance Rent ${fmt(advStart)} – ${fmt(advEnd)} · Unit ${u.unitNumber}`,
            description: isShortTerm
                ? 'Held and refunded or adjusted at the end of the rental'
                : 'Prepays the final rental period — no invoice is raised for it',
            quantity: advWeeks,
            rate: wkRate,
            discountPct: 0,
            amount: advAmount,
        });
    }

    for (const a of quote.addOns || []) {
        items.push({
            sortOrder: items.length,
            itemDetails: a.description ? `${a.name} — ${a.description}` : a.name,
            quantity: toNumber(a.quantity, 1),
            rate: toNumber(a.rate),
            discountPct: 0,
            amount: toNumber(a.amount),
        });
    }

    const depositAmt = toNumber(quote.deposit);
    if (depositAmt > 0) {
        items.push({
            sortOrder: items.length,
            itemDetails: `Security Deposit · Unit ${quote.units[0].unitNumber}`,
            quantity: 1,
            rate: depositAmt,
            discountPct: 0,
            amount: depositAmt,
        });
    }

    /* VAT, on the same terms as the quote it came from.
     *
     * The first invoice carried none: a customer accepted QT-000146 at
     * 20,212.00 including 892.00 of VAT and was then invoiced for the rent
     * with no tax on it at all. The document now says TAX INVOICE and carries
     * a TRN, which makes a claim it has to meet.
     *
     * Charged on this invoice's own lines rather than copied from the quote —
     * the invoice covers the first period, not the whole term — and the
     * refundable lines are outside the base, the rule quoteVat.js holds and
     * the printed quotation already applies. */
    /* Every invoice raised from here on charges VAT.
     *
     * Worked out from this invoice's own lines rather than copied from the
     * quote — the invoice covers the first period, not the whole term — with
     * the refundable ones outside the base, the rule quoteVat.js holds and the
     * printed quotation already applies.
     *
     * Note for anyone converting one of the six quotes that were accepted
     * before VAT existed here: their invoice will come to 5% more than the
     * quote the customer agreed to. */
    {
        const taxable = items.reduce((sum, it) => sum + (isRefundableRow(it.itemDetails) ? 0 : it.amount), 0);
        const vatAmount = vatOn(taxable, Number(quote.vatRate || 5));
        if (vatAmount > 0) {
            items.push({
                sortOrder: items.length,
                itemDetails: `VAT (${Number(quote.vatRate || 5)}%)`,
                quantity: 1,
                rate: vatAmount,
                discountPct: 0,
                amount: vatAmount,
            });
        }
    }

    const invoiceTotal = Number(items.reduce((s, it) => s + it.amount, 0).toFixed(2));
    const dueDate = new Date(Math.min(...quote.units.map((u) => new Date(u.startDate).getTime())));

    return { items, advanceTotal, depositAmt, invoiceTotal, dueDate };
}

export async function createFirstInvoiceFromQuote(quote, contract, userName) {
    const { items, advanceTotal, depositAmt, invoiceTotal, dueDate } = buildFirstInvoice(quote);

    const unitNo = quote.units[0]?.unitNumber || '-';
    const invoice = await Invoice.create({
        invoiceNo: await nextInvoiceNo(unitNo, contract._id),
        customer: quote.customer,
        invoiceDate: new Date(),
        dueDate,
        orderNumber: contract.contractNo,
        terms: 'Due on receipt',
        subject: `Storage Rent · ${contract.contractNo} · from ${quote.quoteNo}`,
        items,
        customerNotes: `Generated from quote ${quote.quoteNo} — prices locked as quoted.`,
        subTotal: invoiceTotal,
        total: invoiceTotal,
        paymentMade: 0,
        status: 'draft',
        createdBy: userName,
    });

    const rentAndAddOns = Number((invoiceTotal - depositAmt - advanceTotal).toFixed(2));
    if (rentAndAddOns > 0) {
        await Payment.create({
            contract: contract._id,
            invoice: invoice._id,
            amount: rentAndAddOns,
            dueDate,
            status: 'pending',
            notes: `Storage Rent (first period) · ${quote.quoteNo}`,
            recordedBy: userName,
        });
    }
    if (advanceTotal > 0) {
        await Payment.create({
            contract: contract._id,
            invoice: invoice._id,
            amount: advanceTotal,
            dueDate,
            status: 'pending',
            notes: `Refundable / Adjustable Security Deposit (last period) · ${quote.quoteNo}`,
            recordedBy: userName,
        });
    }
    if (depositAmt > 0) {
        await Payment.create({
            contract: contract._id,
            invoice: invoice._id,
            amount: depositAmt,
            dueDate,
            status: 'pending',
            notes: `Security deposit · ${quote.quoteNo}`,
            recordedBy: userName,
        });
    }

    return invoice;
}
