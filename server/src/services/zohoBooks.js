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

async function getExpenseAccountId() {
    // Use env var if set (preferred — no extra API call)
    if (process.env.ZOHO_BOOKS_EXPENSE_ACCOUNT_ID) {
        return process.env.ZOHO_BOOKS_EXPENSE_ACCOUNT_ID;
    }
    if (cachedExpenseAccountId) return cachedExpenseAccountId;
    // Fallback: try fetching from chart of accounts
    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };
    try {
        const { data } = await axios.get(`${API_BASE}/chartofaccounts`, {
            headers,
            params: { ...orgParam(), account_type: 'expense' },
        });
        const accounts = data.chartofaccounts || [];
        cachedExpenseAccountId = accounts[0]?.account_id || null;
    } catch {
        cachedExpenseAccountId = null;
    }
    return cachedExpenseAccountId;
}

// Create an expense in Zoho Books from our internal expense.
export async function createZohoExpense(expense) {
    if (!zohoBooksConfigured()) {
        return { configured: false };
    }

    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    const accountId = await getExpenseAccountId();
    if (!accountId) {
        throw new Error('No expense account configured. Set ZOHO_BOOKS_EXPENSE_ACCOUNT_ID in .env');
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
