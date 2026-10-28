import { Payment, Contract, Task, User, nextTaskNo } from '../models/index.js';
import { CollectionAccount, PromiseToPay } from '../models/collections.js';
import { duplicateGroups } from './receivables.js';

/**
 * Collections (WP-21). An account's stage is worked out from its unpaid rows
 * — due today, then reminder 1 (1–7 days late), then reminder 2 — unless a
 * person has moved it to a promise to pay, a payment plan, escalation or
 * write-off. A promise is checked on its date: paid since it was made → kept;
 * not → broken, and the account goes to escalated with a task for finance.
 * Reminders pause while a promise is open or the balance is disputed.
 */

const DAY = 86_400_000;
const r2 = (n) => Math.round(n * 100) / 100;

/** The stage from the payments, unless a person set one. Pure. */
export function stageFor({ manualState = '', oldestOverdueDays = null, dueToday = false }) {
   if (manualState) return manualState;
   if (oldestOverdueDays == null || oldestOverdueDays < 1) return dueToday ? 'due' : 'current';
   return oldestOverdueDays <= 7 ? 'reminder_1' : 'reminder_2';
}

/** kept / broken / open for a promise, from what was paid since it was made. Pure. */
export function promiseOutcome(p, paidSince, now = new Date()) {
   if (paidSince + 0.005 >= p.amount) return 'kept';
   const endOfDay = new Date(p.promisedDate).getTime() + DAY;
   return now.getTime() >= endOfDay ? 'broken' : 'open';
}

/** Contract ids whose reminders should wait: an open promise or a dispute. */
export async function pausedContracts() {
   const [promises, disputes] = await Promise.all([
      PromiseToPay.find({ status: 'open' }).distinct('contract'),
      CollectionAccount.find({ disputed: true }).distinct('contract'),
   ]);
   return new Set([...promises, ...disputes].map(String));
}

export async function collectionsList({ now = new Date() } = {}) {
   const rows = await Payment.find({ status: { $in: ['pending', 'overdue'] }, dueDate: { $lte: new Date(now.getTime() + DAY) } }).select('contract amount dueDate status createdAt').lean();
   const dup = new Set(duplicateGroups(rows).flatMap((g) => g.extraIds));
   const byContract = new Map();
   for (const r of rows) {
      if (dup.has(String(r._id))) continue;
      const k = String(r.contract);
      const e = byContract.get(k) || { owed: 0, oldest: null, rows: 0 };
      e.owed = r2(e.owed + r.amount); e.rows += 1;
      if (!e.oldest || new Date(r.dueDate) < e.oldest) e.oldest = new Date(r.dueDate);
      byContract.set(k, e);
   }
   const ids = [...byContract.keys()];
   const [contracts, accounts, promises] = await Promise.all([
      Contract.find({ _id: { $in: ids } }).select('contractNo status customer unit salesRep').populate('customer', 'fullName phone').populate('unit', 'unitNumber').lean(),
      CollectionAccount.find({ contract: { $in: ids } }).lean(),
      PromiseToPay.find({ contract: { $in: ids }, status: 'open' }).lean(),
   ]);
   const acc = Object.fromEntries(accounts.map((a) => [String(a.contract), a]));
   const prom = Object.fromEntries(promises.map((p) => [String(p.contract), p]));
   const list = contracts.map((c) => {
      const e = byContract.get(String(c._id));
      const days = Math.floor((now - e.oldest) / DAY);
      const a = acc[String(c._id)];
      return {
         contractId: String(c._id), contractNo: c.contractNo, contractStatus: c.status, customer: c.customer?.fullName || '', phone: c.customer?.phone || '', unit: c.unit?.unitNumber || '',
         owed: e.owed, rows: e.rows, oldestDue: e.oldest, daysLate: Math.max(0, days),
         stage: stageFor({ manualState: a?.state, oldestOverdueDays: days, dueToday: days === 0 }),
         disputed: Boolean(a?.disputed), promise: prom[String(c._id)] || null, lastContact: a?.history?.[a.history.length - 1] || null,
      };
   }).sort((x, y) => y.daysLate - x.daysLate);
   const byStage = {};
   for (const r of list) byStage[r.stage] = (byStage[r.stage] || 0) + 1;
   return { accounts: list, byStage, totalOwed: r2(list.reduce((s, r) => s + r.owed, 0)), note: 'Duplicate unpaid rows are left out of what is owed.' };
}

async function log(contractId, entry) {
   await CollectionAccount.updateOne({ contract: contractId }, { $push: { history: { at: new Date(), ...entry } } }, { upsert: true });
}

export async function setStage(contractId, { state, note = '', channel = '', by = '' }) {
   const a = await CollectionAccount.findOne({ contract: contractId }).lean();
   await CollectionAccount.updateOne({ contract: contractId }, { $set: { state }, $push: { history: { at: new Date(), by, from: a?.state || '', to: state, note, channel } } }, { upsert: true });
}

export async function setDispute(contractId, { disputed, note = '', by = '' }) {
   await CollectionAccount.updateOne({ contract: contractId }, { $set: { disputed: Boolean(disputed), disputeNote: note }, $push: { history: { at: new Date(), by, to: disputed ? 'disputed' : 'dispute_closed', note } } }, { upsert: true });
}

export async function addPromise(contractId, { amount, promisedDate, channel = 'call', note = '', by = '' }) {
   await PromiseToPay.updateMany({ contract: contractId, status: 'open' }, { $set: { status: 'broken', resolvedAt: new Date() } });
   const p = await PromiseToPay.create({ contract: contractId, amount, promisedDate, channel, note, createdBy: by });
   await setStage(contractId, { state: 'promise_to_pay', note: `Promised AED ${amount} by ${new Date(promisedDate).toISOString().slice(0, 10)}${note ? ` — ${note}` : ''}`, channel, by });
   return p;
}

export const logContact = (contractId, { channel, note, by }) => log(contractId, { by, channel, note, to: 'contact' });

/** Check open promises whose day has come. Run on a timer. */
export async function checkPromises(now = new Date()) {
   const due = await PromiseToPay.find({ status: 'open', promisedDate: { $lte: now } }).lean();
   let kept = 0; let broken = 0;
   for (const p of due) {
      const paid = await Payment.aggregate([{ $match: { contract: p.contract, status: 'paid', paidDate: { $gte: new Date(new Date(p.createdAt).getTime() - DAY) } } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
      const outcome = promiseOutcome(p, paid[0]?.t || 0, now);
      if (outcome === 'open') continue;
      await PromiseToPay.updateOne({ _id: p._id, status: 'open' }, { $set: { status: outcome, resolvedAt: now } });
      if (outcome === 'kept') { kept += 1; await setStage(p.contract, { state: '', note: 'Promise kept', by: 'system' }); continue; }
      broken += 1;
      await setStage(p.contract, { state: 'escalated', note: `Promise of AED ${p.amount} broken`, by: 'system' });
      const finance = await User.findOne({ role: { $in: ['accounts_admin', 'admin'] }, isActive: { $ne: false } }).sort({ role: 1 }).select('_id').lean();
      const c = await Contract.findById(p.contract).select('contractNo customer').populate('customer', 'fullName').lean();
      if (finance) await Task.create({ taskNo: await nextTaskNo(), title: `Broken promise to pay: ${c?.customer?.fullName || c?.contractNo}`, description: `Promised AED ${p.amount} by ${new Date(p.promisedDate).toISOString().slice(0, 10)}; not paid. Contract ${c?.contractNo}.`, assignedTo: finance._id, createdByName: 'Collections', leadId: p.contract, leadType: 'contract', leadName: c?.customer?.fullName || '', priority: 'high' }).catch((e) => console.error('[Collections] task:', e.message));
   }
   return { kept, broken };
}
