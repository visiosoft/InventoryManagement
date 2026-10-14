import { Lead, WhatsAppMessage, Task, User } from '../models/index.js';
import { AgentAction } from '../agents/models.js';
import { followUpList } from './crmTools.js';

/**
 * Follow-up questions need more than a list of names: they need what was
 * actually said. These put a lead's follow-up plan, what the rep did, and the
 * recent conversation in front of Claude, so it can read the messages and judge
 * ("was the promised follow-up done?", "what does this customer want next?").
 */

const DAY = 864e5;
const iso = (d) => (d ? new Date(d).toISOString() : null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const ago = (d) => (d ? `${Math.floor((Date.now() - new Date(d).getTime()) / DAY)}d ago` : null);
const key9 = (p) => String(p || '').replace(/\D/g, '').slice(-9);

async function findLead({ phone, leadId }) {
  if (leadId) return Lead.findById(leadId).populate('owner', 'name').lean();
  const k = key9(phone);
  return k.length >= 7 ? Lead.findOne({ phoneNormalized: new RegExp(`${k}$`), deletedAt: null }).populate('owner', 'name').lean() : null;
}

async function recentMessages(phoneNormalized, n) {
  const rows = await WhatsAppMessage.find({ phoneNormalized, deletedAt: null, type: { $nin: ['reaction', 'status'] } }).sort({ occurredAt: -1 }).limit(n).select('direction occurredAt text sentByAi type transcript').lean();
  return rows.reverse().map((m) => ({ who: m.direction === 'inbound' ? 'CUSTOMER' : m.sentByAi ? 'us (AI)' : 'us', at: iso(m.occurredAt), text: String(m.text || m.transcript || `(${m.type})`).slice(0, 400) }));
}

const turn = (msgs) => {
  const last = msgs[msgs.length - 1];
  if (!last) return 'no WhatsApp messages';
  return last.who === 'CUSTOMER' ? 'customer wrote last — we owe them a reply' : 'we wrote last — waiting on the customer';
};

/** Everything about one lead's follow-up, with the conversation. */
export async function leadFollowUpFile({ phone, leadId, messages = 20 } = {}) {
  const lead = await findLead({ phone, leadId });
  if (!lead) return { error: 'No lead found for that phone number or id' };
  const n = Math.min(60, Math.max(1, Number(messages) || 20));
  const [msgs, tasks, pending] = await Promise.all([
    recentMessages(lead.phoneNormalized, n),
    Task.find({ leadId: lead._id }).sort({ createdAt: -1 }).limit(10).select('title status dueDate doneAt createdByName').lean(),
    AgentAction.find({ lead: lead._id, resolution: null, kind: { $in: ['reply_drafted', 'touch_proposed', 'followup_proposed', 'deal_check_suggested'] } }).select('kind summary at').lean(),
  ]);
  const now = new Date();
  return {
    lead: { name: lead.fullName, phone: lead.phone, status: lead.status, owner: lead.owner?.name || null, temperature: lead.temperature || null, cameIn: day(lead.leadDateTime), lostReason: lead.lostReason || null },
    followUpPlan: {
      followUpAt: day(lead.followUpAt), dueStatus: lead.followUpAt ? (new Date(lead.followUpAt) < now ? `OVERDUE by ${Math.floor((now - new Date(lead.followUpAt)) / DAY)} day(s)` : 'scheduled') : 'NONE SET',
      note: lead.followUpNote || null, siteVisitAt: day(lead.siteVisitAt), storageStartAt: day(lead.storageStartAt), sequenceExhausted: Boolean(lead.sequenceExhaustedAt),
    },
    whatTheRepDid: (lead.attempts || []).slice(-10).map((a) => ({ no: a.no, at: day(a.at), channel: a.channel, outcome: a.outcome, note: String(a.note || '').slice(0, 200) })),
    firstResponseAt: iso(lead.firstResponseAt),
    timeline: (lead.timeline || []).slice(-15).map((t) => ({ at: iso(t.at), type: t.type, text: String(t.text || '').slice(0, 200) })),
    tasks: tasks.map((t) => ({ title: t.title, status: t.status, due: day(t.dueDate), doneAt: day(t.doneAt) })),
    proposalsWaitingForApproval: pending.map((p) => ({ kind: p.kind, summary: p.summary, at: iso(p.at) })),
    conversation: msgs,
    whoseTurn: turn(msgs),
    daysSinceLastMessage: msgs.length ? Math.floor((Date.now() - new Date(msgs[msgs.length - 1].at).getTime()) / DAY) : null,
  };
}

/** A batch of leads that need a follow-up, each with its latest messages, so Claude can read and prioritise. */
export async function followUpBriefing({ list = 'overdue_followups', rep, limit = 12, messagesPer = 6 } = {}) {
  const l = await followUpList({ list, limit: 200 });
  if (l.error) return l;
  let rows = l.rows;
  if (rep) rows = rows.filter((r) => String(r.rep || '').toLowerCase().includes(String(rep).toLowerCase()));
  rows = rows.slice(0, Math.min(25, Math.max(1, Number(limit) || 12)));
  const out = [];
  for (const r of rows) {
    const lead = await findLead({ phone: r.phone });
    const msgs = lead ? await recentMessages(lead.phoneNormalized, Math.min(15, Number(messagesPer) || 6)) : [];
    out.push({ name: r.name, phone: r.phone, rep: r.rep, status: r.status, why: r.why, followUpAt: day(lead?.followUpAt), lastAttempt: lead?.attempts?.length ? { at: day(lead.attempts[lead.attempts.length - 1].at), outcome: lead.attempts[lead.attempts.length - 1].outcome, note: String(lead.attempts[lead.attempts.length - 1].note || '').slice(0, 160) } : null, whoseTurn: turn(msgs), lastMessages: msgs });
  }
  return { list, meaning: l.meaning, totalOnList: l.total, shown: out.length, hint: 'Read each lead\'s messages to judge what the follow-up should say and how urgent it is.', leads: out };
}

/** Did follow-ups that fell due actually get done? Per rep, from the lead's follow-up date and what we sent after it. */
export async function followUpAdherence({ days = 14 } = {}) {
  const now = new Date();
  const since = new Date(now.getTime() - Math.min(90, Math.max(1, days)) * DAY);
  const leads = await Lead.find({ deletedAt: null, owner: { $ne: null }, followUpAt: { $gte: since, $lt: now } }).select('owner phoneNormalized followUpAt attempts fullName status').lean();
  const names = new Map((await User.find({ _id: { $in: [...new Set(leads.map((l) => String(l.owner)))] } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const out = await WhatsAppMessage.find({ phoneNormalized: { $in: leads.map((l) => l.phoneNormalized).filter(Boolean) }, direction: 'outbound', deletedAt: null, occurredAt: { $gte: since } }).select('phoneNormalized occurredAt').lean();
  const sentBy = new Map();
  for (const m of out) (sentBy.get(m.phoneNormalized) || sentBy.set(m.phoneNormalized, []).get(m.phoneNormalized)).push(new Date(m.occurredAt).getTime());
  const per = new Map();
  const missed = [];
  for (const l of leads) {
    const due = new Date(l.followUpAt).getTime();
    const times = [...(sentBy.get(l.phoneNormalized) || []), ...(l.attempts || []).map((a) => new Date(a.at).getTime())].filter((t) => t >= due - 6 * 36e5);
    const first = times.length ? Math.min(...times) : null;
    const r = per.get(String(l.owner)) || { rep: names.get(String(l.owner)) || 'Unknown', due: 0, onTime: 0, late: 0, missed: 0 };
    r.due += 1;
    if (first == null) { r.missed += 1; if (!['won', 'lost', 'already_customer'].includes(l.status)) missed.push({ name: l.fullName, phone: l.phoneNormalized, rep: r.rep, wasDue: day(l.followUpAt), status: l.status }); }
    else if (first - due <= DAY) r.onTime += 1; else r.late += 1;
    per.set(String(l.owner), r);
  }
  const rows = [...per.values()].map((r) => ({ ...r, onTimePct: r.due ? Math.round((r.onTime / r.due) * 100) : null })).sort((a, b) => b.missed - a.missed);
  return {
    periodDays: days,
    note: 'For leads whose follow-up date fell in this period: done on time = we messaged or logged an attempt within a day of the due date; late = after that; missed = nothing since. A lead whose follow-up date was later moved shows its new date, so this slightly understates what was due.',
    totals: { due: leads.length, onTime: rows.reduce((s, r) => s + r.onTime, 0), late: rows.reduce((s, r) => s + r.late, 0), missed: rows.reduce((s, r) => s + r.missed, 0) },
    perRep: rows,
    missedFollowUps: missed.slice(0, 60),
  };
}
