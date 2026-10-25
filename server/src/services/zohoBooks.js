import axios from 'axios';

// Zoho Books integration for invoice syncing.
// If credentials are not configured, all operations return { configured: false }.

const API_BASE = process.env.ZOHO_BOOKS_API_BASE || 'https://www.zohoapis.com/books/v3';
const ACCOUNTS_BASE = process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com';

export function zohoBooksConfigured() {
    return Boolean(
        process.env.ZOHO_BOOKS_ORG_ID &&
        process.env.ZOHO_BOOKS_CLIENT_ID &&
        process.env.ZOHO_BOOKS_CLIENT_SECRET &&
        process.env.ZOHO_BOOKS_REFRESH_TOKEN
    );
}

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
    if (cachedToken && Date.now() < cachedTokenExpiry - 60_000) return cachedToken;
    const { data } = await axios.post(
        `${ACCOUNTS_BASE}/oauth/v2/token`,
        null,
        {
            params: {
                refresh_token: process.env.ZOHO_BOOKS_REFRESH_TOKEN,
                client_id: process.env.ZOHO_BOOKS_CLIENT_ID,
                client_secret: process.env.ZOHO_BOOKS_CLIENT_SECRET,
                grant_type: 'refresh_token',
            },
        }
    );
    cachedToken = data.access_token;
    cachedTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return cachedToken;
}

function orgParam() {
    return { organization_id: process.env.ZOHO_BOOKS_ORG_ID };
}

// Find or create a customer in Zoho Books by name/email.
async function findOrCreateContact(customer) {
    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    // Search by email first
    if (customer.email) {
        const { data } = await axios.get(`${API_BASE}/contacts`, {
            headers,
            params: { ...orgParam(), email: customer.email },
        });
        if (data.contacts?.length > 0) return data.contacts[0].contact_id;
    }

    // Search by name
    const { data: byName } = await axios.get(`${API_BASE}/contacts`, {
        headers,
        params: { ...orgParam(), contact_name: customer.fullName },
    });
    if (byName.contacts?.length > 0) return byName.contacts[0].contact_id;

    // Create new
    const { data: created } = await axios.post(
        `${API_BASE}/contacts`,
        {
            contact_name: customer.fullName,
            contact_type: 'customer',
            email: customer.email || '',
            phone: customer.phone || '',
        },
        { headers, params: orgParam() }
    );
    return created.contact?.contact_id;
}

// Create an invoice in Zoho Books from our internal invoice.
export async function createZohoInvoice(invoice) {
    if (!zohoBooksConfigured()) {
        return { configured: false };
    }

    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    const customer = invoice.customer;
    const contactId = await findOrCreateContact(customer);

    const lineItems = (invoice.items || []).map((item) => ({
        name: item.itemDetails || 'Service',
        description: item.itemDetails || '',
        quantity: item.quantity || 1,
        rate: item.rate || item.amount || 0,
        discount: item.discountPct ? `${item.discountPct}%` : undefined,
    }));

    const BANK_INFO = `Bank Details:\nMashreq Bank\nSHORT TERM STORAGE LLC\nAccount Number: 019101745789\nIBAN Number: AE500330000019101745789\nAddress: Unit 12, ABA Avenue Al Quoz 2, Dubai`;

    const DEFAULT_TERMS = `• Storage rental is charged in advance for each 28-day period.\n• Items stored are at the customer's own risk; insurance is the customer's responsibility.\n• No illegal, hazardous, flammable, or perishable goods are allowed.\n• Customer is responsible for packing, locking, and securing stored items.\n• Late payment may result in restricted access or additional charges.\n• Short Term Storage LLC is not liable for loss or damage unless caused by proven negligence.\n• Access to storage is allowed only during official working hours.`;

    const body = {
        customer_id: contactId,
        reference_number: invoice.invoiceNo,
        date: invoice.invoiceDate
            ? new Date(invoice.invoiceDate).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        line_items: lineItems,
        notes: (invoice.customerNotes || '') + '\n\n' + BANK_INFO,
        terms: invoice.termsAndConditions || DEFAULT_TERMS,
    };

    // Ensure due_date is after invoice date (Zoho rejects otherwise)
    if (invoice.dueDate) {
        const invDate = new Date(invoice.invoiceDate || Date.now());
        const dueDate = new Date(invoice.dueDate);
        if (dueDate > invDate) {
            body.due_date = dueDate.toISOString().slice(0, 10);
        } else {
            // Set due date to invoice date + 7 days as fallback
            const fallback = new Date(invDate);
            fallback.setDate(fallback.getDate() + 7);
            body.due_date = fallback.toISOString().slice(0, 10);
        }
    }

    const { data } = await axios.post(`${API_BASE}/invoices`, body, {
        headers,
        params: orgParam(),
    });

    return {
        configured: true,
        zohoInvoiceId: data.invoice?.invoice_id,
        zohoInvoiceUrl: data.invoice?.invoice_url || null,
    };
}

// Record a payment against a Zoho Books invoice.
export async function recordZohoPayment(zohoInvoiceId, amount, date, method) {
    if (!zohoBooksConfigured()) return { configured: false };

    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    const body = {
        invoice_id: zohoInvoiceId,
        amount,
        date: date ? new Date(date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        payment_mode: method || 'cash',
    };

    // Need to get the invoice first to get customer_id
    const { data: invData } = await axios.get(`${API_BASE}/invoices/${zohoInvoiceId}`, {
        headers,
        params: orgParam(),
    });
    body.customer_id = invData.invoice?.customer_id;

    const { data } = await axios.post(`${API_BASE}/customerpayments`, body, {
        headers,
        params: orgParam(),
    });

    return { configured: true, paymentId: data.payment?.payment_id };
}

// Get expense account ID from env or fetch from Zoho
let cachedExpenseAccountId = null;
let cachedExpenseAccounts = null;

async function fetchExpenseAccounts() {
    if (cachedExpenseAccounts) return cachedExpenseAccounts;
    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };
    try {
        const { data } = await axios.get(`${API_BASE}/chartofaccounts`, {
            headers,
            params: { ...orgParam(), account_type: 'expense' },
        });
        cachedExpenseAccounts = data.chartofaccounts || [];
    } catch {
        cachedExpenseAccounts = [];
    }
    return cachedExpenseAccounts;
}

async function getExpenseAccountId(expenseAccountName) {
    // Try to match by name first
    if (expenseAccountName) {
        const accounts = await fetchExpenseAccounts();
        const normalizedName = expenseAccountName.toLowerCase().trim();
        const match = accounts.find(a =>
            a.account_name.toLowerCase().trim() === normalizedName
        );
        if (match) return match.account_id;
    }
    // Use env var as default fallback
    if (process.env.ZOHO_BOOKS_EXPENSE_ACCOUNT_ID) {
        return process.env.ZOHO_BOOKS_EXPENSE_ACCOUNT_ID;
    }
    if (cachedExpenseAccountId) return cachedExpenseAccountId;
    // Last resort: fetch and use first expense account
    const accounts = await fetchExpenseAccounts();
    cachedExpenseAccountId = accounts[0]?.account_id || null;
    return cachedExpenseAccountId;
}

// Create an expense in Zoho Books from our internal expense.
export async function createZohoExpense(expense) {
    if (!zohoBooksConfigured()) {
        return { configured: false };
    }

    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    const accountId = await getExpenseAccountId(expense.expenseAccount);
    if (!accountId) {
        throw new Error('No expense account configured. Set ZOHO_BOOKS_EXPENSE_ACCOUNT_ID in .env or ensure a matching Zoho expense account exists');
    }

    const body = {
        account_id: accountId,
        date: expense.expenseDate
            ? new Date(expense.expenseDate).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        amount: expense.total || expense.expenseAmount || 0,
        description: [expense.description, expense.expenseAccount ? `[${expense.expenseAccount}]` : ''].filter(Boolean).join(' '),
        reference_number: expense.referenceNo || expense.expenseReferenceId || '',
        is_billable: expense.isBillable || false,
        currency_code: expense.currencyCode || 'AED',
    };

    // If there's a vendor, try to find/create them as a vendor in Zoho
    if (expense.vendorName || expense.vendor?.contactName) {
        const vendorName = expense.vendor?.contactName || expense.vendorName;
        try {
            // Search for existing vendor
            const { data: searchRes } = await axios.get(`${API_BASE}/contacts`, {
                headers,
                params: { ...orgParam(), contact_name: vendorName, contact_type: 'vendor' },
            });
            if (searchRes.contacts?.length > 0) {
                body.vendor_id = searchRes.contacts[0].contact_id;
            } else {
                // Create as vendor
                const { data: created } = await axios.post(`${API_BASE}/contacts`, {
                    contact_name: vendorName,
                    contact_type: 'vendor',
                }, { headers, params: orgParam() });
                body.vendor_id = created.contact?.contact_id;
            }
        } catch { /* proceed without vendor */ }
    }

    const { data } = await axios.post(`${API_BASE}/expenses`, body, {
        headers,
        params: orgParam(),
    });

    return {
        configured: true,
        zohoExpenseId: data.expense?.expense_id,
    };
}

// Create expense in Zoho Books and attach a receipt file.
export async function createZohoExpenseWithReceipt(expense, file) {
    if (!zohoBooksConfigured()) {
        return { configured: false };
    }

    // First create the expense
    const result = await createZohoExpense(expense);
    if (!result.configured || !result.zohoExpenseId) return result;

    // If a file is provided, upload it as a receipt
    if (file && file.buffer) {
        const token = await getAccessToken();
        const headers = { Authorization: `Zoho-oauthtoken ${token}` };

        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('receipt', file.buffer, {
            filename: file.originalname || 'receipt',
            contentType: file.mimetype || 'application/octet-stream',
        });

        await axios.post(
            `${API_BASE}/expenses/${result.zohoExpenseId}/receipt`,
            form,
            {
                headers: { ...headers, ...form.getHeaders() },
                params: orgParam(),
            }
        );
    }

    return result;
}

// Fetch all vendors from Zoho Books (paginated, fetches all pages).
export async function fetchZohoVendors() {
    if (!zohoBooksConfigured()) {
        return { configured: false, vendors: [] };
    }

    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    let allVendors = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const { data } = await axios.get(`${API_BASE}/contacts`, {
            headers,
            params: { ...orgParam(), contact_type: 'vendor', page, per_page: 200 },
        });

        const contacts = data.contacts || [];
        allVendors = allVendors.concat(contacts);
        hasMore = data.page_context?.has_more_page || false;
        page++;
    }

    return { configured: true, vendors: allVendors };
}

// Fetch recent expenses from Zoho Books.
export async function fetchZohoExpenses(limit = 50, { fromDate, toDate } = {}) {
    if (!zohoBooksConfigured()) {
        return { configured: false, expenses: [] };
    }

    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    const params = { ...orgParam(), per_page: limit, sort_column: 'date', sort_order: 'D' };
    if (fromDate) params.date_start = fromDate;
    if (toDate) params.date_end = toDate;

    const { data } = await axios.get(`${API_BASE}/expenses`, {
        headers,
        params,
    });

    return { configured: true, expenses: data.expenses || [] };
}


// All customers in Zoho Books, paginated through. Cached briefly — the list
// is only needed for the comparison screen.
let contactsCache = { at: 0, contacts: [] };
export async function listAllZohoContacts({ force = false } = {}) {
    if (!zohoBooksConfigured()) return { configured: false, contacts: [] };
    if (!force && contactsCache.contacts.length && Date.now() - contactsCache.at < 5 * 60_000) {
        return { configured: true, contacts: contactsCache.contacts };
    }
    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };
    const contacts = [];
    let page = 1;
    for (;;) {
        const { data } = await axios.get(`${API_BASE}/contacts`, {
            headers,
            params: { ...orgParam(), contact_type: 'customer', per_page: 200, page },
        });
        for (const c of data.contacts || []) {
            contacts.push({
                id: c.contact_id,
                name: c.contact_name || c.company_name || '',
                company: c.company_name || '',
                email: c.email || '',
                phone: c.phone || '',
                mobile: c.mobile || '',
                status: c.status || '',
                outstanding: Number(c.outstanding_receivable_amount || 0),
            });
        }
        if (!data.page_context?.has_more_page) break;
        page += 1;
        if (page > 50) break; // safety valve
    }
    contactsCache = { at: Date.now(), contacts };
    return { configured: true, contacts };
}


// ── Matching a local customer to Zoho Books contacts ─────────────────────────
// Names differ between the two systems for the same person, so matching is on
// email and phone only — never on name.

const normEmail = (v) => String(v || '').trim().toLowerCase();

// UAE numbers are stored inconsistently (+971 50…, 0050…, 9715…), so compare
// on the last 9 digits. Anything shorter is skipped rather than risking a
// false match.
const phoneKey = (v) => {
    const digits = String(v || '').replace(/\D/g, '');
    return digits.length >= 9 ? digits.slice(-9) : '';
};

// Contacts in Zoho Books that match this person by email or phone only.
export async function findZohoContactsFor({ emails = [], phones = [] } = {}) {
    if (!zohoBooksConfigured()) return { configured: false, contacts: [] };

    const emailSet = new Set(emails.map(normEmail).filter(Boolean));
    const phoneSet = new Set(phones.map(phoneKey).filter(Boolean));
    if (!emailSet.size && !phoneSet.size) return { configured: true, contacts: [] };

    const { contacts: all } = await listAllZohoContacts();

    const matched = [];
    for (const c of all || []) {
        const cEmail = normEmail(c.email);
        let matchedBy = null;
        if (cEmail && emailSet.has(cEmail)) {
            matchedBy = 'email';
        } else {
            const keys = [phoneKey(c.phone), phoneKey(c.mobile)].filter(Boolean);
            if (keys.some((k) => phoneSet.has(k))) matchedBy = 'phone';
        }
        if (!matchedBy) continue;
        matched.push({
            id: c.id,
            name: c.name || '',
            email: c.email || '',
            phone: c.phone || '',
            mobile: c.mobile || '',
            matchedBy,
        });
    }
    return { configured: true, contacts: matched };
}

/**
 * What each local customer owes, according to Zoho Books.
 *
 * Built from the cached contact list, which already carries
 * `outstanding_receivable_amount` per contact — so this costs one API call
 * every five minutes rather than one call per customer. Fetching invoices
 * instead would mean a request per contact: 138 sequential round trips, far
 * too slow to sit behind a filter on a list page.
 *
 * Matching is on email and phone only, never name, because the same person is
 * routinely spelled differently in the two systems. That is deliberate and it
 * has a cost: a customer whose email and phone do not appear in Zoho cannot be
 * matched at all, so callers are told how many owed balances went unclaimed
 * rather than being left to assume the list is complete.
 *
 * Returns { byCustomer: Map<customerId, {outstanding, zohoName}>, unmatchedOwing }.
 */
export async function zohoOutstandingByCustomer(customers) {
    if (!zohoBooksConfigured()) return { configured: false, byCustomer: new Map(), unmatchedOwing: 0 };

    const { contacts } = await listAllZohoContacts();

    // Index the Zoho side once, then walk our customers — the reverse would be
    // quadratic across a few hundred of each.
    const byEmail = new Map();
    const byPhone = new Map();
    for (const c of contacts || []) {
        const e = normEmail(c.email);
        if (e && !byEmail.has(e)) byEmail.set(e, c);
        for (const key of [phoneKey(c.phone), phoneKey(c.mobile)]) {
            if (key && !byPhone.has(key)) byPhone.set(key, c);
        }
    }

    const byCustomer = new Map();
    const claimed = new Set();
    for (const cust of customers || []) {
        const e = normEmail(cust.email);
        let hit = e ? byEmail.get(e) : null;
        if (!hit) {
            const keys = [...(Array.isArray(cust.phones) ? cust.phones : []), cust.phone]
                .map(phoneKey).filter(Boolean);
            for (const k of keys) { hit = byPhone.get(k); if (hit) break; }
        }
        if (!hit) continue;
        claimed.add(String(hit.id));
        byCustomer.set(String(cust._id), {
            outstanding: Number(hit.outstanding || 0),
            zohoName: hit.name || '',
        });
    }

    // Money Zoho says is owed that we could not attach to anyone here. Shown in
    // the UI so an incomplete list never reads as a complete one.
    const unmatchedOwing = (contacts || [])
        .filter((c) => Number(c.outstanding || 0) > 0 && !claimed.has(String(c.id)))
        .length;

    return { configured: true, byCustomer, unmatchedOwing };
}

// Invoices for the given Zoho contact ids.
export async function fetchZohoInvoicesForContacts(contactIds) {
    if (!zohoBooksConfigured()) return { configured: false, invoices: [] };

    const ids = [...new Set((contactIds || []).filter(Boolean).map(String))];
    if (!ids.length) return { configured: true, invoices: [] };

    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    const byId = new Map();
    for (const customerId of ids) {
        let page = 1;
        for (;;) {
            const { data } = await axios.get(`${API_BASE}/invoices`, {
                headers,
                params: { ...orgParam(), customer_id: customerId, per_page: 200, page },
            });
            for (const inv of data.invoices || []) {
                if (byId.has(inv.invoice_id)) continue;
                byId.set(inv.invoice_id, {
                    id: inv.invoice_id,
                    number: inv.invoice_number,
                    date: inv.date,
                    dueDate: inv.due_date,
                    total: Number(inv.total || 0),
                    balance: Number(inv.balance || 0),
                    status: inv.status,
                    currency: inv.currency_code,
                    customerName: inv.customer_name,
                    url: inv.invoice_url || '',
                });
            }
            if (!data.page_context?.has_more_page) break;
            page += 1;
            if (page > 50) break; // safety valve
        }
    }

    const invoices = [...byId.values()].sort(
        (a, b) => String(b.date || '').localeCompare(String(a.date || ''))
    );
    return { configured: true, invoices };
}

// Payments received from the given Zoho contact ids, newest first.
export async function fetchZohoPaymentsForContacts(contactIds) {
    if (!zohoBooksConfigured()) return { configured: false, payments: [] };

    const ids = [...new Set((contactIds || []).filter(Boolean).map(String))];
    if (!ids.length) return { configured: true, payments: [] };

    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    const byId = new Map();
    for (const customerId of ids) {
        let page = 1;
        for (;;) {
            const { data } = await axios.get(`${API_BASE}/customerpayments`, {
                headers,
                params: { ...orgParam(), customer_id: customerId, per_page: 200, page },
            });
            for (const p of data.customerpayments || []) {
                if (byId.has(p.payment_id)) continue;
                byId.set(p.payment_id, {
                    id: p.payment_id,
                    number: p.payment_number,
                    date: p.date,
                    amount: Number(p.amount || 0),
                    mode: p.payment_mode || '',
                    reference: p.reference_number || '',
                    invoiceNumbers: p.invoice_numbers || '',
                    currency: p.currency_code,
                });
            }
            if (!data.page_context?.has_more_page) break;
            page += 1;
            if (page > 50) break; // safety valve
        }
    }

    const payments = [...byId.values()].sort(
        (a, b) => String(b.date || '').localeCompare(String(a.date || ''))
    );
    return { configured: true, payments };
}

// The rendered PDF for one Zoho invoice, so staff can read it without holding
// a Zoho Books login of their own. Returns a Buffer.
export async function fetchZohoInvoicePdf(invoiceId) {
    if (!zohoBooksConfigured()) return { configured: false, pdf: null };
    const token = await getAccessToken();
    const { data } = await axios.get(`${API_BASE}/invoices/${invoiceId}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/pdf' },
        params: { ...orgParam(), accept: 'pdf' },
        responseType: 'arraybuffer',
    });
    return { configured: true, pdf: Buffer.from(data) };
}


/* ── The Zoho Books home dashboard, rebuilt from the API ─────────────────────
   Zoho has no API for its own dashboard widgets, so the same figures are
   worked out from the documents behind them. Each section is fetched on its
   own and fails on its own: one Zoho error leaves the others standing. */

async function zohoListAll(path, key, params = {}, maxPages = 25) {
    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };
    let out = [];
    for (let page = 1; page <= maxPages; page++) {
        const { data } = await axios.get(`${API_BASE}/${path}`, {
            headers, params: { ...orgParam(), page, per_page: 200, ...params },
        });
        out = out.concat(data[key] || []);
        if (!data.page_context?.has_more_page) break;
    }
    return out;
}

/* Which list filters mean "still owed". Invoices and bills do not share a
 * vocabulary: bills reject Status.Unpaid ("Invalid value passed for
 * filter_by") and use the status parameter's open / overdue /
 * partially_paid instead. */
const OPEN_FILTERS = {
    invoices: [{ filter_by: 'Status.Unpaid' }, { filter_by: 'Status.PartiallyPaid' }, { filter_by: 'Status.OverDue' }],
    bills: [{ status: 'open' }, { status: 'overdue' }, { status: 'partially_paid' }],
};

/** Unpaid documents (invoices or bills) from every "still owed" filter, de-duplicated.
 *  A filter Zoho rejects is skipped; only if every one fails is it an error. */
async function openDocuments(path, key, idField) {
    const seen = new Map();
    const failures = [];
    const filters = OPEN_FILTERS[path] || [{ filter_by: 'Status.Unpaid' }];
    for (const params of filters) {
        try {
            for (const d of await zohoListAll(path, key, params)) seen.set(d[idField], d);
        } catch (e) {
            failures.push(e);
        }
    }
    if (failures.length === filters.length) throw failures[0];
    return [...seen.values()];
}

/** Total, current and overdue, the way Zoho's Receivables / Payables cards split it. */
export function splitOutstanding(docs, today = new Date().toISOString().slice(0, 10)) {
    let current = 0;
    let overdue = 0;
    for (const d of docs) {
        const bal = Number(d.balance ?? 0);
        if (!(bal > 0)) continue;
        if (d.due_date && d.due_date < today) overdue += bal; else current += bal;
    }
    const r = (n) => Math.round(n * 100) / 100;
    return { total: r(current + overdue), current: r(current), overdue: r(overdue), count: docs.filter((d) => Number(d.balance) > 0).length };
}

/** Sum an amount field into the twelve months of a year: [{ month: '2026-01', value }]. */
export function byMonth(rows, year, amountOf, dateOf = (r) => r.date) {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, value: 0 }));
    for (const row of rows) {
        const d = String(dateOf(row) || '');
        if (!d.startsWith(String(year))) continue;
        const m = Number(d.slice(5, 7)) - 1;
        if (m >= 0 && m < 12) months[m].value += Number(amountOf(row) || 0);
    }
    return months.map((m) => ({ ...m, value: Math.round(m.value * 100) / 100 }));
}

let dashboardCache = { at: 0, data: null };

export async function zohoBooksDashboard({ force = false } = {}) {
    if (!zohoBooksConfigured()) return { configured: false };
    if (!force && dashboardCache.data && Date.now() - dashboardCache.at < 10 * 60_000) return dashboardCache.data;

    const year = new Date().getFullYear();
    const range = { date_start: `${year}-01-01`, date_end: `${year}-12-31` };
    const problems = [];
    const safe = async (label, fn, fallback) => {
        try { return await fn(); } catch (e) {
            problems.push(`${label}: ${e.response?.data?.message || e.message}`);
            return fallback;
        }
    };

    const [openInvoices, openBills, banks, payIn, payOut, expenses, invoicesYear, billsYear] = await Promise.all([
        safe('Receivables', () => openDocuments('invoices', 'invoices', 'invoice_id'), null),
        safe('Payables', () => openDocuments('bills', 'bills', 'bill_id'), null),
        safe('Bank accounts', () => zohoListAll('bankaccounts', 'bankaccounts'), null),
        safe('Customer payments', () => zohoListAll('customerpayments', 'customerpayments', range), null),
        safe('Vendor payments', () => zohoListAll('vendorpayments', 'vendorpayments', range), null),
        safe('Expenses', () => zohoListAll('expenses', 'expenses', range), null),
        safe('Invoices', () => zohoListAll('invoices', 'invoices', range), null),
        safe('Bills', () => zohoListAll('bills', 'bills', range), null),
    ]);

    const moneyIn = payIn ? byMonth(payIn, year, (p) => p.amount) : null;
    const moneyOut = payOut || expenses
        ? byMonth([...(payOut || []), ...(expenses || [])], year, (r) => r.amount ?? r.total)
        : null;
    const income = invoicesYear ? byMonth(invoicesYear.filter((i) => !['void', 'draft'].includes(i.status)), year, (i) => i.total) : null;
    const spend = expenses || billsYear
        ? byMonth([...(expenses || []), ...((billsYear || []).filter((b) => !['void', 'draft'].includes(b.status)))], year, (r) => r.total ?? r.amount)
        : null;

    const topExpenses = expenses
        ? Object.entries(expenses.reduce((acc, e) => {
            const k = e.account_name || 'Other';
            acc[k] = (acc[k] || 0) + Number(e.total ?? e.amount ?? 0);
            return acc;
        }, {})).map(([account, total]) => ({ account, total: Math.round(total * 100) / 100 }))
            .sort((a, b) => b.total - a.total).slice(0, 6)
        : null;

    const sum = (arr) => (arr ? Math.round(arr.reduce((s, m) => s + m.value, 0) * 100) / 100 : null);
    const data = {
        configured: true,
        year,
        orgId: process.env.ZOHO_BOOKS_ORG_ID,
        receivables: openInvoices ? splitOutstanding(openInvoices) : null,
        payables: openBills ? splitOutstanding(openBills) : null,
        bank: banks ? {
            total: Math.round(banks.filter((b) => b.is_active !== false).reduce((s, b) => s + Number(b.balance || 0), 0) * 100) / 100,
            accounts: banks.filter((b) => b.is_active !== false)
                .map((b) => ({ name: b.account_name, type: b.account_type, balance: Number(b.balance || 0) })),
        } : null,
        cashFlow: moneyIn || moneyOut ? { moneyIn, moneyOut, totalIn: sum(moneyIn), totalOut: sum(moneyOut) } : null,
        incomeExpense: income || spend ? { income, expense: spend, totalIncome: sum(income), totalExpense: sum(spend) } : null,
        topExpenses,
        problems,
        fetchedAt: new Date().toISOString(),
    };
    dashboardCache = { at: Date.now(), data };
    return data;
}

/** Just the receivables card — what the Overview tab shows — without
 *  fetching the rest of the Zoho dashboard. Cached ten minutes. */
let receivablesCache = { at: 0, data: null };
export async function zohoReceivables({ force = false } = {}) {
    if (!zohoBooksConfigured()) return { configured: false };
    if (!force && receivablesCache.data && Date.now() - receivablesCache.at < 10 * 60_000) return receivablesCache.data;
    // The full dashboard, if it was fetched recently, already has the answer.
    if (!force && dashboardCache.data?.receivables && Date.now() - dashboardCache.at < 10 * 60_000) {
        return { configured: true, receivables: dashboardCache.data.receivables, orgId: process.env.ZOHO_BOOKS_ORG_ID, fetchedAt: dashboardCache.data.fetchedAt };
    }
    const docs = await openDocuments('invoices', 'invoices', 'invoice_id');
    const data = { configured: true, receivables: splitOutstanding(docs), orgId: process.env.ZOHO_BOOKS_ORG_ID, fetchedAt: new Date().toISOString() };
    receivablesCache = { at: Date.now(), data };
    return data;
}

/* ── Sales, the way a seller dashboard shows it ──────────────────────────────
   Invoiced per day for the last 31 days, and the totals for today, 7, 31 and
   90 days, each against the same length of time just before it. Sales are
   invoices (not void or draft) by invoice date; collected is customer
   payments by payment date. Dates are Zoho's own (the org's time zone). */

const isoDay = (d) => d.toISOString().slice(0, 10);
const addDays = (day, n) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000));

/** Pure: the sales card from invoice and payment rows. `today` is YYYY-MM-DD. */
export function salesSummary(invoices, payments, today) {
    const r = (n) => Math.round(n * 100) / 100;
    const sales = (invoices || []).filter((i) => !['void', 'draft'].includes(i.status));
    const sumBetween = (rows, from, to, amountOf) => r(rows.filter((x) => x.date >= from && x.date <= to).reduce((s, x) => s + Number(amountOf(x) || 0), 0));
    const period = (days) => {
        const from = addDays(today, -(days - 1));
        const value = sumBetween(sales, from, today, (i) => i.total);
        const before = sumBetween(sales, addDays(from, -days), addDays(from, -1), (i) => i.total);
        return { days, value, before, change: before > 0 ? Math.round(((value - before) / before) * 1000) / 10 : null };
    };
    const byDay = Array.from({ length: 31 }, (_, k) => {
        const date = addDays(today, k - 30);
        return { date, value: sumBetween(sales, date, date, (i) => i.total) };
    });
    const from90 = addDays(today, -89);
    return {
        today,
        periods: [1, 7, 31, 90].map(period),
        byDay,
        sales90: sumBetween(sales, from90, today, (i) => i.total),
        invoices90: sales.filter((i) => i.date >= from90 && i.date <= today).length,
        collected90: sumBetween(payments || [], from90, today, (p) => p.amount),
    };
}

let salesCache = { at: 0, data: null };
export async function zohoSales({ force = false } = {}) {
    if (!zohoBooksConfigured()) return { configured: false };
    if (!force && salesCache.data && Date.now() - salesCache.at < 10 * 60_000) return salesCache.data;
    // Dubai's date, which is the org's.
    const today = isoDay(new Date(Date.now() + 4 * 3600000));
    const [invoices, payments] = await Promise.all([
        zohoListAll('invoices', 'invoices', { date_start: addDays(today, -179), date_end: today }),
        zohoListAll('customerpayments', 'customerpayments', { date_start: addDays(today, -89), date_end: today }),
    ]);
    const data = { configured: true, orgId: process.env.ZOHO_BOOKS_ORG_ID, ...salesSummary(invoices, payments, today), fetchedAt: new Date().toISOString() };
    salesCache = { at: Date.now(), data };
    return data;
}
