import { Customer } from '../models/index.js';
import { zohoBooksConfigured, listAllZohoContacts, findZohoContactsFor, fetchZohoInvoicesForContacts, fetchZohoPaymentsForContacts, fetchZohoExpenses } from '../services/zohoBooks.js';

/** What Zoho Books knows, through the connection the CRM already has. Read-only. */

const money = (n) => Number(Number(n || 0).toFixed(2));
const NOT_SET = { error: 'Zoho Books is not connected on the server (its credentials are not set).' };
const rx = (q) => new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

export async function zohoOutstanding({ limit = 50 } = {}) {
  if (!zohoBooksConfigured()) return NOT_SET;
  const { contacts } = await listAllZohoContacts();
  const owing = contacts.filter((c) => c.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
  return { customersOwing: owing.length, totalOutstandingAed: money(owing.reduce((s, c) => s + c.outstanding, 0)), top: owing.slice(0, Math.min(200, Math.max(1, limit))).map((c) => ({ name: c.name, email: c.email, phone: c.mobile || c.phone, outstandingAed: money(c.outstanding) })), note: 'As Zoho Books shows it. A customer is shown here whether or not they match a CRM record.' };
}

export async function zohoCustomerLedger({ query }) {
  if (!zohoBooksConfigured()) return NOT_SET;
  const digits = String(query || '').replace(/\D/g, '');
  const customers = await Customer.find(digits.length >= 7 ? { $or: [{ phone: new RegExp(`${digits.slice(-9)}$`) }, { phones: new RegExp(`${digits.slice(-9)}$`) }] } : { fullName: rx(query) }).select('fullName email phone phones').limit(3).lean();
  if (!customers.length) return { error: 'No CRM customer matches that name or number' };
  const out = [];
  for (const c of customers) {
    const { contacts } = await findZohoContactsFor({ emails: [c.email].filter(Boolean), phones: [c.phone, ...(c.phones || [])].filter(Boolean) });
    if (!contacts.length) { out.push({ customer: c.fullName, zoho: 'No matching Zoho customer (matched by email or phone only)' }); continue; }
    const ids = contacts.map((x) => x.id);
    const [{ invoices }, { payments }] = await Promise.all([fetchZohoInvoicesForContacts(ids), fetchZohoPaymentsForContacts(ids)]);
    out.push({ customer: c.fullName, zohoContacts: contacts.map((x) => x.name), invoices: invoices.slice(0, 40).map((i) => ({ number: i.number, date: i.date, due: i.dueDate, total: money(i.total), balance: money(i.balance), status: i.status })), payments: payments.slice(0, 40).map((p) => ({ number: p.number, date: p.date, amount: money(p.amount), mode: p.mode, forInvoices: p.invoiceNumbers })), balanceAed: money(invoices.reduce((s, i) => s + (i.balance || 0), 0)) });
  }
  return { results: out };
}

export async function zohoExpenses({ from, to, limit = 100 } = {}) {
  if (!zohoBooksConfigured()) return NOT_SET;
  const { expenses } = await fetchZohoExpenses(Math.min(200, Math.max(1, limit)), { fromDate: from, toDate: to });
  const byCategory = new Map();
  for (const e of expenses) byCategory.set(e.account_name || 'Uncategorised', (byCategory.get(e.account_name || 'Uncategorised') || 0) + Number(e.total || e.amount || 0));
  return { count: expenses.length, totalAed: money(expenses.reduce((s, e) => s + Number(e.total || e.amount || 0), 0)), byCategory: [...byCategory].map(([category, total]) => ({ category, totalAed: money(total) })).sort((a, b) => b.totalAed - a.totalAed), rows: expenses.map((e) => ({ date: e.date, vendor: e.vendor_name || '', category: e.account_name || '', amountAed: money(e.total || e.amount), description: String(e.description || '').slice(0, 100) })) };
}
