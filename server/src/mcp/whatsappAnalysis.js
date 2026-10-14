import { WhatsAppMessage, Lead, User } from '../models/index.js';

/**
 * WhatsApp, for analysis: how long customers wait for an answer, when they
 * write, what they ask. Read from the stored message history; nothing is sent.
 */

const MIN = 60000;
const HOUR = 36e5;
const DAY = 864e5;
const DUBAI = 4 * HOUR;
const mins = (ms) => Math.round(ms / MIN);
const human = (m) => (m == null ? null : m < 90 ? `${m} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dubai = (d) => new Date(new Date(d).getTime() + DUBAI);
/** Mon–Sat, 09:00–19:00 Dubai time. */
const workingHours = (d) => { const x = dubai(d); const dow = x.getUTCDay(); const h = x.getUTCHours(); return dow !== 0 && h >= 9 && h < 19; };

async function load(days, maxRows = 120000) {
  const since = new Date(Date.now() - Math.min(180, Math.max(1, days)) * DAY);
  return WhatsAppMessage.find({ occurredAt: { $gte: since }, deletedAt: null, type: { $nin: ['reaction', 'status'] } })
    .select('phoneNormalized direction occurredAt sentByAi text').sort({ phoneNormalized: 1, occurredAt: 1 }).limit(maxRows).lean();
}

function summarise(gaps) {
  if (!gaps.length) return { answeredTurns: 0 };
  const g = gaps.map((x) => x.ms);
  const within = (ms) => Math.round((g.filter((x) => x <= ms).length / g.length) * 100);
  const avg = mins(g.reduce((a, b) => a + b, 0) / g.length);
  const med = mins(median(g));
  return { answeredTurns: g.length, averageMinutes: avg, averageReadable: human(avg), medianMinutes: med, medianReadable: human(med), within5MinPct: within(5 * MIN), within1HourPct: within(HOUR), over24HoursPct: 100 - within(24 * HOUR) };
}

export async function whatsappReplyTimeReport({ days = 30 } = {}) {
  const msgs = await load(days);
  const now = Date.now();
  const gaps = [];
  let unanswered = 0; let unansweredLong = 0;
  const byPhone = new Map();
  for (const m of msgs) { (byPhone.get(m.phoneNormalized) || byPhone.set(m.phoneNormalized, []).get(m.phoneNormalized)).push(m); }
  for (const [phone, list] of byPhone) {
    for (let i = 0; i < list.length; i += 1) {
      const m = list[i];
      if (m.direction !== 'inbound') continue;
      if (i > 0 && list[i - 1].direction === 'inbound') continue; // a burst counts once, from its first message
      const next = list.slice(i + 1).find((x) => x.direction === 'outbound');
      const t = new Date(m.occurredAt).getTime();
      if (next) gaps.push({ phone, ms: new Date(next.occurredAt).getTime() - t, ai: Boolean(next.sentByAi), working: workingHours(m.occurredAt), at: m.occurredAt });
      else if (now - t > HOUR) { unanswered += 1; if (now - t > 24 * HOUR) unansweredLong += 1; }
    }
  }
  const leads = await Lead.find({ phoneNormalized: { $in: [...byPhone.keys()] }, deletedAt: null }).select('phoneNormalized owner').lean();
  const ownerOf = new Map(leads.map((l) => [l.phoneNormalized, l.owner ? String(l.owner) : null]));
  const names = new Map((await User.find({ _id: { $in: [...new Set([...ownerOf.values()].filter(Boolean))] } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const perRep = new Map();
  for (const g of gaps) { const k = ownerOf.get(g.phone) || 'none'; (perRep.get(k) || perRep.set(k, []).get(k)).push(g); }
  const human_ = gaps.filter((g) => !g.ai);
  return {
    periodDays: days,
    note: 'A "turn" is a customer message (or burst of messages) followed by our next outbound message. Reply time = from the customer\'s first message of the turn to that reply. Replies written by the AI assistant are counted separately from replies by a person. "Working hours" = customer wrote Mon–Sat 09:00–19:00 Dubai time. Conversations are attributed to the lead\'s owner.',
    allReplies: summarise(gaps),
    repliedByAPerson: summarise(human_),
    repliedByAI: { answeredTurns: gaps.length - human_.length },
    customerWroteDuringWorkingHours: summarise(gaps.filter((g) => g.working)),
    customerWroteOutsideWorkingHours: summarise(gaps.filter((g) => !g.working)),
    unansweredTurns: { overOneHour: unanswered, overTwentyFourHours: unansweredLong },
    perRep: [...perRep].map(([k, list]) => ({ rep: k === 'none' ? 'No owner' : names.get(k) || 'Unknown', ...summarise(list.filter((g) => !g.ai)), repliedByAI: list.filter((g) => g.ai).length })).sort((a, b) => (b.averageMinutes ?? 0) - (a.averageMinutes ?? 0)),
    truncated: msgs.length >= 120000 ? 'Hit the 120,000-message cap; use a shorter period for exact figures.' : undefined,
  };
}

export async function whatsappVolumeReport({ days = 30 } = {}) {
  const msgs = await load(days);
  const byHour = Array.from({ length: 24 }, () => 0);
  const byDow = Array.from({ length: 7 }, () => 0);
  const perDay = new Map();
  let inbound = 0; let outbound = 0; let ai = 0;
  const started = new Set(); const replied = new Set(); const seen = new Set();
  for (const m of msgs) {
    const d = dubai(m.occurredAt);
    const key = d.toISOString().slice(0, 10);
    const row = perDay.get(key) || { date: key, inbound: 0, outbound: 0 };
    if (m.direction === 'inbound') { inbound += 1; row.inbound += 1; byHour[d.getUTCHours()] += 1; byDow[d.getUTCDay()] += 1; if (!seen.has(m.phoneNormalized)) started.add(m.phoneNormalized); }
    else { outbound += 1; row.outbound += 1; if (m.sentByAi) ai += 1; replied.add(m.phoneNormalized); }
    seen.add(m.phoneNormalized);
    perDay.set(key, row);
  }
  const dn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const neverReplied = [...started].filter((p) => !replied.has(p)).length;
  return { periodDays: days, conversations: seen.size, messagesFromCustomers: inbound, messagesWeSent: outbound, sentByAI: ai, newConversationsStarted: started.size, newConversationsNeverReplied: neverReplied, busiestHoursDubai: byHour.map((n, h) => ({ hour: `${String(h).padStart(2, '0')}:00`, customerMessages: n })).sort((a, b) => b.customerMessages - a.customerMessages).slice(0, 5), customerMessagesByWeekday: byDow.map((n, i) => ({ day: dn[i], customerMessages: n })), perDay: [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

const TOPICS = {
  price: /\b(price|prices|cost|how much|rate|rates|quote|quotation|aed|dirham|discount|cheaper|offer)\b|سعر|كم|خصم/i,
  availability_size: /\b(available|availability|size|sqft|sq ft|square|big|small|how many|unit|room|locker)\b|متوفر|مساحة/i,
  visit: /\b(visit|see the|come|tour|location|where|address|map|open|hours|time)\b|زيارة|موقع/i,
  duration: /\b(week|weeks|month|months|short term|long term|duration|until|from|start)\b|شهر|اسبوع/i,
  payment: /\b(pay|payment|invoice|transfer|card|deposit|receipt|bank|cash)\b|دفع/i,
  access_security: /\b(access|24|security|cctv|lock|key|insurance|safe)\b|امن/i,
  moving: /\b(moving|movers|truck|pack|packing|transport|furniture)\b|نقل/i,
  cancel_leave: /\b(cancel|terminate|move out|vacate|leaving|end contract|refund)\b|الغاء/i,
};

export async function whatsappTopicsReport({ days = 30 } = {}) {
  const since = new Date(Date.now() - Math.min(180, Math.max(1, days)) * DAY);
  const rows = await WhatsAppMessage.find({ direction: 'inbound', occurredAt: { $gte: since }, deletedAt: null, type: 'text', text: { $ne: '' } }).select('phoneNormalized text').limit(60000).lean();
  const counts = Object.fromEntries(Object.keys(TOPICS).map((k) => [k, new Set()]));
  const people = new Set();
  for (const r of rows) { people.add(r.phoneNormalized); for (const [k, re] of Object.entries(TOPICS)) if (re.test(r.text)) counts[k].add(r.phoneNormalized); }
  return { periodDays: days, customersWhoWrote: people.size, textMessagesRead: rows.length, note: 'People who mentioned each topic at least once (keyword match in English and some Arabic; a rough guide). Use whatsapp_inbound_sample for the actual wording.', topics: Object.entries(counts).map(([topic, set]) => ({ topic, customers: set.size, sharePct: people.size ? Math.round((set.size / people.size) * 100) : 0 })).sort((a, b) => b.customers - a.customers) };
}

export async function whatsappInboundSample({ days = 14, keyword = '', limit = 60 } = {}) {
  const since = new Date(Date.now() - Math.min(180, Math.max(1, days)) * DAY);
  const f = { direction: 'inbound', occurredAt: { $gte: since }, deletedAt: null, type: 'text', text: { $ne: '' } };
  if (keyword) f.text = new RegExp(String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const rows = await WhatsAppMessage.find(f).select('occurredAt text').sort({ occurredAt: -1 }).limit(Math.min(200, Math.max(1, limit))).lean();
  return { total: rows.length, note: 'Customer messages with no names or numbers, for finding themes, objections and questions.', messages: rows.map((r) => ({ at: new Date(r.occurredAt).toISOString().slice(0, 16), text: String(r.text).slice(0, 300) })) };
}
