/**
 * Reading a chat for what the customer committed to.
 *
 * "Call me in two weeks", "after Ramadan", "I need to ask my wife", "we are
 * moving flats in November" — each is a fact the CRM should hold and a rep
 * will forget to type. This reads the customer's message (and the few before
 * it), and proposes three things a person can accept in one tap:
 *
 *   - a follow-up date, with the words that justify it
 *   - who makes the decision
 *   - why they want the storage, in their own words
 *
 * Nothing is applied here. The model is cheap to ask but wrong sometimes, so
 * a proposal is an agent action a person approves, and every one carries the
 * customer's own sentence so the person can see what it is based on.
 */

import { chatJson, openaiConfigured } from '../services/openai.js';

// Words that suggest a time, in English and Arabic. Deliberately generous:
// this only decides whether the model is asked, never what is proposed.
const TIMING = /\b(tomorrow|tonight|today|next\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this\s+(weekend|month|week)|end of (the )?(week|month|year)|in\s+(a|an|\d+|one|two|three|four|five|six|a few|few|couple of)\s*(day|days|week|weeks|month|months)|after\s+(ramadan|eid|the holidays?|my|our|i|we)|(january|february|march|april|may|june|july|august|september|october|november|december)|later|get back to you|call me|contact me|message me|remind|let you know|decide|think about it)\b|بعد\s*(اسبوع|أسبوع|شهر|رمضان|العيد|يومين|ثلاث)|الاسبوع|الأسبوع|الشهر\s*(الجاي|القادم)|بكره|بكرا|غدا|غداً|لاحقا|لاحقاً|بعدين|راجعك|كلمني|اتصل/i;
const DECISION = /\b(my\s+(wife|husband|partner|boss|manager|director|brother|sister|father|dad|mother|mom|family|company|landlord)|ask\s+(my|the|him|her)|check with|discuss with|talk to|need approval|approve|finance|accounts?\s+department|committee)\b|زوجتي|زوجي|مديري|الشركة|اسأل|استشير|موافقة/i;
const REASON = /\b(because|since|moving|move\s+(out|in|house|flat|apartment)|renovat|refurbish|relocat|travel|leaving|shipping|furniture|inventory|stock|business|documents|storing|need\s+(space|storage))\b|بسبب|انتقال|نقل|سفر|تجديد|اثاث|أثاث|بضاعة/i;

/** Is this message worth asking a model about? */
export function worthReading(text, { needDecision = true, needWhy = true } = {}) {
    const t = String(text || '');
    if (t.trim().length < 6) return false;
    if (TIMING.test(t)) return true;
    return (needDecision && DECISION.test(t)) || (needWhy && REASON.test(t));
}

/** Today in Dubai, as YYYY-MM-DD. */
export function dubaiDay(now = new Date()) {
    return new Date(new Date(now).getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}

/** A proposed follow-up date is only worth keeping if it is a real, future, not-absurd day. */
export function validFollowUpDay(day, now = new Date()) {
    const d = String(day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
    const t = new Date(`${d}T00:00:00.000Z`).getTime();
    if (Number.isNaN(t)) return '';
    const today = new Date(`${dubaiDay(now)}T00:00:00.000Z`).getTime();
    if (t <= today) return '';
    if (t - today > 400 * 86_400_000) return '';
    return d;
}

const SYSTEM = (today, weekday) => [
    'You read a WhatsApp conversation between a self-storage company in Dubai and a customer, and pull out what the CUSTOMER said. The conversation may be in English or Arabic (Gulf dialect). Answer with JSON only.',
    `Today is ${weekday} ${today} (Dubai). Resolve relative dates yourself: "next week" is about 7 days away, "in two weeks" 14 days, "after Ramadan" the first day after Eid al-Fitr of the coming Ramadan, "end of the month" the last day of this month.`,
    'Return: {"followUp": null | {"date": "YYYY-MM-DD", "reason": short phrase about what the follow-up is for, "quote": the customer\'s exact words that gave the timing}, "decisionMaker": null | {"name": who decides (e.g. "his wife", "the finance manager"), "quote": exact words}, "why": null | {"text": why they want storage, in their own words, under 140 characters, "quote": exact words}}.',
    'Rules: only report what the customer plainly said in the LAST message (earlier messages are context). If the customer gave a time but no exact day, give your best single date. Never invent. If a field is not stated, use null. A vague "later" or "I will think" with no timeframe is followUp null.',
].join('\n');

/**
 * Ask the model. Returns normalised, validated proposals — never throws, so a
 * model outage costs a suggestion and nothing else.
 *
 * @param history  [{ direction, text }] oldest first, the customer's last message last
 */
export async function extractCommitments({ history = [], now = new Date(), model, effort } = {}) {
    const empty = { followUp: null, decisionMaker: null, why: null };
    if (!openaiConfigured()) return empty;
    const lines = history.slice(-8).map((m) => `${m.direction === 'inbound' ? 'CUSTOMER' : 'US'}: ${String(m.text || '').slice(0, 400)}`).join('\n');
    if (!lines) return empty;
    const weekday = new Date(`${dubaiDay(now)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    let out;
    try {
        out = await chatJson({ system: SYSTEM(dubaiDay(now), weekday), messages: [{ role: 'user', content: lines }], temperature: 0, maxTokens: 400, model, effort });
    } catch (e) {
        console.error('[Agents] commitments:', e.message);
        return empty;
    }
    return normalise(out, now);
}

export function normalise(out, now = new Date()) {
    const text = (v, n) => String(v || '').trim().slice(0, n);
    const result = { followUp: null, decisionMaker: null, why: null };
    if (!out || typeof out !== 'object') return result;
    const day = validFollowUpDay(out.followUp?.date, now);
    if (day && text(out.followUp?.quote, 300)) {
        result.followUp = { date: day, reason: text(out.followUp.reason, 140), quote: text(out.followUp.quote, 300) };
    }
    if (text(out.decisionMaker?.name, 120) && text(out.decisionMaker?.quote, 300)) {
        result.decisionMaker = { name: text(out.decisionMaker.name, 120), quote: text(out.decisionMaker.quote, 300) };
    }
    if (text(out.why?.text, 140) && text(out.why?.quote, 300)) {
        result.why = { text: text(out.why.text, 140), quote: text(out.why.quote, 300) };
    }
    return result;
}
