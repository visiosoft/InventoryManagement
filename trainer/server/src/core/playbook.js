import crypto from 'node:crypto';
import { asData, DATA_RULE } from './text.js';
import { AUTHORITY } from './knowledge.js';
import { PURPLEBOX_WHATSAPP } from './purplebox.js';

/**
 * Sales playbooks: how an organisation wants its agent to sell, and how a
 * reply is scored. Pure. A playbook is organisation configuration, not code —
 * the conversation states, the Next Best Actions, the lead fields to learn,
 * the weighted scorecard, the automatic fails, the media the agent may pick
 * and the gates before going live are all data an owner can change.
 *
 * Two templates ship: a general customer-service one, and the self-storage
 * sales playbook from the PurpleBox AI Sales Training & Deployment
 * Specification (v1.0, October 2026).
 */

/* ---------- templates ---------- */

const STORAGE = {
   template: 'self_storage_sales',
   name: 'Self-storage sales',
   goal: 'Help the customer choose the right storage and take the next step: preferably a facility visit, or a remote reservation when they are ready.',
   contract: [
      'You are the self-storage sales consultant. Help customers choose the right storage solution and confidently take the next appropriate step: preferably a facility visit, or a remote reservation when they are ready.',
      'Always: understand the actual storage need; answer direct questions directly; recommend rather than list options; explain why a recommendation fits; use only verified facts, live prices, live availability and approved promotions; mention only the 2–4 benefits most relevant to this customer; use media when it reduces uncertainty or shows the facility; pick one Next Best Action after each customer message; protect customer trust and company margin; escalate when facts, authority or policy are uncertain.',
      'Never: invent information; hide a requested price; pressure or manipulate; manufacture scarcity or false deadlines; attack competitors; offer an unauthorised discount; repeat questions already answered; keep selling after the customer is ready to transact; end a qualified conversation without a specific next step.',
      'Style: WhatsApp-length, human and confident, no corporate greetings or long paragraphs, one or two questions at most. When the customer asks how to pay, whether a unit is free, how to reserve, what documents are needed, or says they need it now, switch to closing: stop pitching and move to availability, reservation and payment.',
      'Discounts: never lead with one. Diagnose the price objection first and only use an incentive the facts list as authorised. Anything outside that: say it will be checked and escalate.',
   ].join('\n'),
   states: [
      { key: 'new_inquiry', label: 'New inquiry', objective: 'Identify intent and answer the explicit question' },
      { key: 'discovery', label: 'Discovery', objective: 'Understand use case, items, timing and access' },
      { key: 'recommendation', label: 'Recommendation', objective: 'Recommend the right unit and explain why' },
      { key: 'value', label: 'Value presentation', objective: 'Connect relevant features to the need' },
      { key: 'price', label: 'Price / quote', objective: 'Give the price clearly, in context' },
      { key: 'consideration', label: 'Consideration', objective: 'Help compare options' },
      { key: 'objection', label: 'Objection', objective: 'Find the real blocker and address it' },
      { key: 'visit', label: 'Visit', objective: 'Secure a date and time' },
      { key: 'closing', label: 'Closing', objective: 'Availability, reservation and payment' },
      { key: 'follow_up', label: 'Follow-up', objective: 'Re-engage on timing and prior context' },
      { key: 'escalation', label: 'Escalation', objective: 'Hand cases outside scope to a person' },
   ],
   actions: [
      { key: 'ask_discovery', label: 'Ask discovery question', when: 'Important qualification data is missing' },
      { key: 'recommend_size', label: 'Recommend size', when: 'Enough item or volume information exists' },
      { key: 'give_price', label: 'Give price / quote', when: 'Customer asks for a price or a recommendation is established' },
      { key: 'send_unit_media', label: 'Send unit image/video', when: 'Seeing the unit will reduce uncertainty' },
      { key: 'send_facility_tour', label: 'Send facility tour', when: 'Facility quality matters or visit intent should be created' },
      { key: 'explain_feature', label: 'Explain relevant feature', when: 'A feature directly answers the need or objection' },
      { key: 'handle_objection', label: 'Handle objection', when: 'A blocker is explicit or strongly implied' },
      { key: 'offer_incentive', label: 'Offer authorised incentive', when: 'Value is established and price is still the real blocker' },
      { key: 'invite_visit', label: 'Invite facility visit', when: 'Customer is qualified and seeing the facility would help', outcome: 'visit' },
      { key: 'book_visit', label: 'Book visit', when: 'Customer accepts a visit', outcome: 'visit' },
      { key: 'reserve', label: 'Reserve / payment', when: 'Buying signal is high', outcome: 'booking' },
      { key: 'schedule_follow_up', label: 'Schedule follow-up', when: 'The need exists but timing is later', outcome: 'follow_up' },
      { key: 'escalate', label: 'Escalate', when: 'Policy, complaint, negotiation, unusual request or low confidence', outcome: 'escalation' },
   ],
   fields: [
      { key: 'customer_type', label: 'Customer type', hint: 'Personal / Business' },
      { key: 'use_case', label: 'Use case', hint: 'Moving, renovation, travel, decluttering, inventory, files' },
      { key: 'items', label: 'Items / volume', hint: 'Furniture, boxes, documents, inventory, equipment' },
      { key: 'start_date', label: 'Start date', hint: 'Date or approximate timing' },
      { key: 'duration', label: 'Duration', hint: 'Weeks / months / unknown' },
      { key: 'access_frequency', label: 'Access frequency', hint: 'Rare / occasional / frequent' },
      { key: 'estimated_size', label: 'Estimated size', hint: 'sq ft' },
      { key: 'price_sensitivity', label: 'Price sensitivity', hint: 'Low / medium / high' },
      { key: 'buying_intent', label: 'Buying intent', hint: 'Low / medium / high' },
      { key: 'primary_objection', label: 'Primary objection', hint: 'Price, distance, size, trust, timing, approval' },
      { key: 'competitor', label: 'Competitor', hint: 'None / named / quote' },
      { key: 'media_actions', label: 'Media / actions done', hint: 'Video sent, visit booked, quote sent, payment sent' },
   ],
   rubric: [
      { key: 'accuracy', label: 'Factual accuracy', weight: 25, expect: 'Uses approved facts; never invents price, availability, policy or promotion' },
      { key: 'understanding', label: 'Understanding', weight: 15, expect: 'Interprets intent correctly and keeps known context' },
      { key: 'recommendation', label: 'Recommendation', weight: 15, expect: 'Right size or action, with a clear reason' },
      { key: 'progression', label: 'Sales progression', weight: 15, expect: 'Moves the conversation one logical step forward' },
      { key: 'value', label: 'Value', weight: 10, expect: 'Relevant differentiation without feature dumping' },
      { key: 'objection', label: 'Objection handling', weight: 10, expect: 'Diagnoses the blocker; no premature discount' },
      { key: 'tone', label: 'Tone', weight: 5, expect: 'Short, human, confident, helpful' },
      { key: 'cta', label: 'Next step', weight: 5, expect: 'A specific, appropriate next step' },
   ],
   autoFails: [
      { key: 'invented_price', label: 'Invented price or availability' },
      { key: 'fabricated_promotion', label: 'Fabricated promotion' },
      { key: 'false_claim', label: 'False security or policy claim' },
      { key: 'unauthorized_discount', label: 'Unauthorised discount' },
      { key: 'ignored_question', label: 'Ignored a direct question' },
      { key: 'contradiction', label: 'Contradicts known context' },
      { key: 'pressure', label: 'Inappropriate pressure' },
      { key: 'no_escalation', label: 'Failed to escalate' },
   ],
   media: [
      { key: 'facility_tour', label: 'Facility tour video', tags: ['facility', 'visit', 'trust'] },
      { key: 'unit_small', label: 'Small unit video (10–35 sq ft)', tags: ['small', 'boxes', 'documents'] },
      { key: 'unit_medium', label: 'Medium unit video (50–75 sq ft)', tags: ['medium', 'furniture'] },
      { key: 'unit_large', label: 'Large unit video (100–200 sq ft)', tags: ['large', 'villa', 'inventory'] },
      { key: 'security_access', label: 'Security and 24/7 access video', tags: ['security', 'access', 'trust'] },
      { key: 'location_map', label: 'Location pin (Al Quoz)', tags: ['location', 'visit'] },
   ],
   groups: [
      { key: 'pricing', label: 'Pricing', min: 10 },
      { key: 'sizing', label: 'Sizing', min: 12 },
      { key: 'personal', label: 'Personal use', min: 10 },
      { key: 'business', label: 'Business use', min: 12 },
      { key: 'facility', label: 'Facility', min: 12 },
      { key: 'objections', label: 'Objections', min: 20 },
      { key: 'closing', label: 'Closing', min: 8 },
      { key: 'follow_up', label: 'Follow-up', min: 8 },
      { key: 'edge', label: 'Edge cases', min: 10 },
      { key: 'escalation', label: 'Escalation', min: 10 },
   ],
   gates: { corePass: 95, factual: 100, autoFails: 0, avgScore: 90, blind: 90, completion: 90, escalation: 100, maxDrop: 2, blindSample: 20 },
   passMark: 80,
   shareContract: false,
};

const SUPPORT = {
   template: 'customer_service',
   name: 'Customer service',
   goal: 'Answer the customer correctly and help them to the next step.',
   contract: 'Answer the question directly, from approved facts only. Be brief and warm. Ask one useful question when it helps. Hand anything uncertain, a complaint, or a request outside policy to a person.',
   states: [
      { key: 'question', label: 'Question', objective: 'Answer what was asked' },
      { key: 'clarify', label: 'Clarify', objective: 'Get the one detail needed' },
      { key: 'resolve', label: 'Resolve', objective: 'Complete the request' },
      { key: 'escalation', label: 'Escalation', objective: 'Hand to a person' },
   ],
   actions: [
      { key: 'answer', label: 'Answer', when: 'The facts cover the question' },
      { key: 'ask_clarifying', label: 'Ask clarifying question', when: 'A detail is missing' },
      { key: 'complete', label: 'Complete request', when: 'The customer wants something done', outcome: 'booking' },
      { key: 'schedule_follow_up', label: 'Follow up later', when: 'The customer is not ready', outcome: 'follow_up' },
      { key: 'escalate', label: 'Escalate', when: 'Complaint, policy or low confidence', outcome: 'escalation' },
   ],
   fields: [
      { key: 'need', label: 'Need', hint: 'What they want' },
      { key: 'urgency', label: 'Urgency', hint: 'Low / medium / high' },
      { key: 'sentiment', label: 'Sentiment', hint: 'Positive / neutral / upset' },
   ],
   rubric: [
      { key: 'accuracy', label: 'Accuracy', weight: 40, expect: 'Only approved facts' },
      { key: 'understanding', label: 'Understanding', weight: 20, expect: 'Answers what was asked' },
      { key: 'progression', label: 'Next step', weight: 20, expect: 'Moves the customer forward' },
      { key: 'tone', label: 'Tone', weight: 20, expect: 'Brief, warm, professional' },
   ],
   autoFails: [
      { key: 'invented_price', label: 'Invented figure or availability' },
      { key: 'false_claim', label: 'False policy claim' },
      { key: 'ignored_question', label: 'Ignored a direct question' },
      { key: 'no_escalation', label: 'Failed to escalate' },
   ],
   media: [],
   groups: [
      { key: 'common', label: 'Common questions', min: 20 },
      { key: 'edge', label: 'Edge cases', min: 10 },
      { key: 'escalation', label: 'Escalation', min: 10 },
   ],
   gates: { corePass: 95, factual: 100, autoFails: 0, avgScore: 85, blind: 90, completion: 90, escalation: 100, maxDrop: 2, blindSample: 20 },
   passMark: 80,
   shareContract: false,
};

export const TEMPLATES = { purplebox_whatsapp: PURPLEBOX_WHATSAPP, self_storage_sales: STORAGE, customer_service: SUPPORT };

/** The playbook an organisation uses: its own, else the general template. Pure. */
export const playbookOf = (org) => (org?.playbook?.template ? org.playbook : SUPPORT);

/* ---------- cleaning what an owner saves ---------- */

const KEY = /^[a-z][a-z0-9_]{0,40}$/;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const list = (arr, max, map) => (Array.isArray(arr) ? arr : []).map(map).filter((x) => x && KEY.test(x.key)).filter((x, i, a) => a.findIndex((y) => y.key === x.key) === i).slice(0, max);
const validPattern = (s) => { try { new RegExp(s, 'i'); return s; } catch { return ''; } };
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** A playbook as saved: known fields only, sizes capped, keys valid. Throws on an unusable one. Pure. */
export function cleanPlaybook(p) {
   const base = TEMPLATES[p?.template] || SUPPORT;
   const g = p?.gates || {};
   const out = {
      template: base.template,
      name: str(p?.name || base.name, 80),
      goal: str(p?.goal ?? base.goal, 600),
      contract: str(p?.contract ?? base.contract, 20000),
      states: list(p?.states ?? base.states, 30, (s) => ({ key: str(s?.key, 41), label: str(s?.label, 60), objective: str(s?.objective, 200) })),
      actions: list(p?.actions ?? base.actions, 30, (a) => ({ key: str(a?.key, 41), label: str(a?.label, 60), when: str(a?.when, 200), outcome: ['visit', 'booking', 'follow_up', 'escalation'].includes(a?.outcome) ? a.outcome : '' })),
      fields: list(p?.fields ?? base.fields, 30, (f) => ({ key: str(f?.key, 41), label: str(f?.label, 60), hint: str(f?.hint, 120) })),
      rubric: list(p?.rubric ?? base.rubric, 12, (r) => ({ key: str(r?.key, 41), label: str(r?.label, 60), weight: num(r?.weight, 0, 100, 0), expect: str(r?.expect, 200) })),
      autoFails: list(p?.autoFails ?? base.autoFails, 20, (a) => ({ key: str(a?.key, 41), label: str(a?.label, 80) })),
      media: list(p?.media ?? base.media, 40, (m) => ({ key: str(m?.key, 41), label: str(m?.label, 80), tags: (Array.isArray(m?.tags) ? m.tags : String(m?.tags || '').split(',')).map((t) => str(t, 30).toLowerCase()).filter(Boolean).slice(0, 10), url: /^https:\/\//.test(String(m?.url || '')) ? str(m.url, 500) : '' })),
      groups: list(p?.groups ?? base.groups, 20, (x) => ({ key: str(x?.key, 41), label: str(x?.label, 60), min: num(x?.min, 0, 500, 0) })),
      gates: {
         corePass: num(g.corePass, 0, 100, base.gates.corePass), factual: num(g.factual, 0, 100, base.gates.factual), autoFails: num(g.autoFails, 0, 1000, base.gates.autoFails),
         avgScore: num(g.avgScore, 0, 100, base.gates.avgScore), blind: num(g.blind, 0, 100, base.gates.blind), completion: num(g.completion, 0, 100, base.gates.completion),
         escalation: num(g.escalation, 0, 100, base.gates.escalation), maxDrop: num(g.maxDrop, 0, 100, base.gates.maxDrop), blindSample: num(g.blindSample, 1, 1000, base.gates.blindSample),
      },
      // Patterns code checks every reply for: a match is that automatic fail. Invalid patterns are dropped.
      codeRules: list(p?.codeRules ?? base.codeRules ?? [], 20, (r) => ({ key: str(r?.key, 41), label: str(r?.label, 80), pattern: validPattern(str(r?.pattern, 400)) })).filter((r) => r.pattern),
      passMark: num(p?.passMark, 0, 100, base.passMark),
      shareContract: Boolean(p?.shareContract),
   };
   if (!out.actions.some((a) => a.key === 'escalate')) throw new Error('Keep an "escalate" action: the agent must always be able to hand over');
   if (!out.rubric.length || !out.rubric.some((r) => r.weight > 0)) throw new Error('The scorecard needs at least one weighted measure');
   if (!out.states.length) throw new Error('Add at least one conversation state');
   return out;
}

/**
 * A short fingerprint of everything that shapes the agent's behaviour, so a
 * test run records which playbook it ran on and a change shows as a new
 * version. Pure.
 */
export function promptVersion(p) {
   const shape = { contract: p.contract, goal: p.goal, states: p.states, actions: p.actions, fields: p.fields, media: p.media };
   return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 8);
}

/* ---------- the agent and the observer ---------- */

const bullet = (rows, f) => rows.map((r) => `- ${f(r)}`).join('\n');

/** The hosted sales agent: picks the state and one Next Best Action first, then writes. Pure. */
export function agentSystem(org, p) {
   return [
      `You are the conversational agent for ${org.business || org.name}. ${p.goal}`,
      'BEHAVIOUR CONTRACT:', p.contract,
      'CONVERSATION STATES:', bullet(p.states, (s) => `${s.key}: ${s.label} — ${s.objective}`),
      'NEXT BEST ACTIONS (choose exactly one before writing; the reply must carry it out):', bullet(p.actions, (a) => `${a.key}: ${a.label} — use when ${a.when}`),
      'LEAD FIELDS to keep up to date from everything the customer has said (value null if unknown; confidence 0–1):', bullet(p.fields, (f) => `${f.key}: ${f.label} (${f.hint})`),
      p.media.length ? `MEDIA you may choose to attach (by key; nothing is really sent): ${p.media.map((m) => `${m.key} = ${m.label}`).join('; ')}` : 'There is no media library.',
      `When sources disagree, follow this order: ${AUTHORITY.join(' > ')}.`,
      org.prohibited?.length ? `Never say: ${org.prohibited.join('; ')}.` : '',
      `Keep the reply under ${org.maxReplyLength || 700} characters.`,
      'Use ONLY the business facts and approved answers given. If a price, availability or promotion is not in them, do not state one: say you will check, and escalate if it blocks the customer.',
      'Actions (visit bookings, reservations, payment links, follow-ups, hand-overs) are simulated: describe what you would do in "actions"; never claim something was done that needs a person.',
      DATA_RULE,
      'Reply with JSON only: {"state": key, "nba": key, "lead": {field_key: {"value": string|null, "confidence": number}}, "reply": string, "media": [key], "actions": [{"type": string, "detail": string}], "factsUsed": [short quote of each fact or approved answer you relied on], "needsHuman": boolean, "reason": "one line: why this action"}',
   ].filter(Boolean).join('\n');
}

/** For an agent running elsewhere (it only returns text): what that reply implies. Pure. */
export function observerSystem(p) {
   return [
      'You read a sales conversation and the reply an agent just wrote, and record what that reply does. You do not rewrite it.',
      'STATES:', bullet(p.states, (s) => `${s.key}: ${s.label}`),
      'ACTIONS:', bullet(p.actions, (a) => `${a.key}: ${a.label}`),
      'LEAD FIELDS:', bullet(p.fields, (f) => `${f.key}: ${f.label}`),
      p.media.length ? `MEDIA keys: ${p.media.map((m) => m.key).join(', ')}` : '',
      DATA_RULE,
      'Reply with JSON only: {"state": key, "nba": key the reply carries out, "lead": {field_key: {"value": string|null, "confidence": number}}, "media": [key the reply sends or promises], "actions": [{"type": string, "detail": string}]}',
   ].filter(Boolean).join('\n');
}

/** The conversation, lead and facts as the agent sees them. Pure. */
/**
 * An approved scenario as a worked example an agent can learn from: the
 * situation, the right action and the reply the business approved. Matched to
 * a new message by the customer's words. Pure.
 */
export function exampleFrom(s) {
   return {
      id: String(s._id ?? s.id), question: String(s.message || ''), variations: [s.title, s.intent].filter(Boolean).map(String),
      context: (s.context || []).slice(-2).map((m) => ({ from: m.from, text: String(m.text || '').slice(0, 300) })),
      nba: (s.nba || [])[0] || '', reply: String(s.idealResponse || ''), escalate: Boolean(s.mustEscalate),
   };
}

/** Worked examples for a prompt. Prices in them are examples only: live facts win. Pure. */
export function examplesBlock(examples = [], actionLabel = (k) => k) {
   if (!examples.length) return '';
   return [
      'APPROVED EXAMPLES — replies the business approved for situations like this one. Follow their approach, length, tone and next step, in words that fit this customer. Any price, date or availability in them is only an example: use the live facts.',
      ...examples.map((e, i) => [
         `Example ${i + 1}:`,
         ...e.context.map((m) => `  ${m.from === 'agent' ? 'Agent' : 'Customer'}: ${m.text}`),
         `  Customer: ${e.question}`,
         `  Right action: ${actionLabel(e.nba) || 'reply'}${e.escalate ? ' (hand to a person)' : ''}`,
         e.reply ? `  Approved reply: ${e.reply}` : '',
      ].filter(Boolean).join('\n')),
   ].join('\n\n');
}

export function turnPrompt({ context = [], message, lead = {}, answers = [], facts = '', examples = '' }) {
   const convo = context.map((m) => `${m.from === 'agent' ? 'Agent' : 'Customer'}: ${m.text}`).join('\n');
   return [
      examples,
      answers.length ? `APPROVED ANSWERS:\n${answers.map((a) => `[${a.id}] Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}` : 'APPROVED ANSWERS: none match.',
      `BUSINESS FACTS:\n${facts || '(none)'}`,
      `LEAD STATE BEFORE THIS MESSAGE: ${JSON.stringify(lead)}`,
      convo ? `CONVERSATION SO FAR:\n${asData(convo, 'conversation')}` : 'CONVERSATION SO FAR: (this is the first message)',
      `Customer's new message: ${asData(message)}`,
   ].filter(Boolean).join('\n\n');
}

/** A model's turn made safe: only known states, actions, fields and media. Pure. */
export function cleanTurn(out, p) {
   const states = new Set(p.states.map((s) => s.key));
   const actions = new Set(p.actions.map((a) => a.key));
   const media = new Set(p.media.map((m) => m.key));
   const lead = {};
   for (const f of p.fields) {
      const v = out?.lead?.[f.key];
      const value = v && typeof v === 'object' ? v.value : v;
      if (value == null || value === '') continue;
      lead[f.key] = { value: String(value).slice(0, 200), confidence: Math.max(0, Math.min(1, Number(v?.confidence ?? 0.5) || 0)) };
   }
   const nba = actions.has(out?.nba) ? out.nba : (out?.needsHuman ? 'escalate' : '');
   return {
      state: states.has(out?.state) ? out.state : '',
      nba,
      lead,
      reply: String(out?.reply ?? '').slice(0, 4000),
      media: (Array.isArray(out?.media) ? out.media : []).filter((k) => media.has(k)).slice(0, 4),
      actions: (Array.isArray(out?.actions) ? out.actions : []).slice(0, 5).map((a) => ({ type: String(a?.type || '').slice(0, 40), detail: String(a?.detail || '').slice(0, 200), simulated: true })),
      factsUsed: (Array.isArray(out?.factsUsed) ? out.factsUsed : []).map((f) => String(f).slice(0, 200)).slice(0, 8),
      needsHuman: Boolean(out?.needsHuman) || nba === 'escalate',
      reason: String(out?.reason || '').slice(0, 300),
   };
}

/* ---------- scoring ---------- */

/** The scorecard judge. Pure. */
export function scoreSystem(p) {
   return [
      'You are a strict sales QA reviewer. Score ONE agent reply in a customer conversation against the business scorecard. A reply can sound good and still be commercially weak; a strong close is unacceptable if a fact is invented.',
      'SCORECARD (score each 0–100):', bullet(p.rubric, (r) => `${r.key}: ${r.label} — ${r.expect}`),
      'A measure that does not apply to this message (for example objection handling when there is no objection) scores 100 if the reply does nothing wrong there.',
      'AUTOMATIC FAILS (list every one that happened, by key; when in doubt about a fact, check it against the BUSINESS FACTS):', bullet(p.autoFails, (a) => `${a.key}: ${a.label}`),
      'ACTIONS the agent may choose:', bullet(p.actions, (a) => `${a.key}: ${a.label} — ${a.when}`),
      'Judge whether the agent\'s chosen action is an acceptable next step here (nbaOk). If the expected actions are given, an action outside them is not acceptable unless clearly as good.',
      DATA_RULE,
      'Reply with JSON only: {"scores": {key: n}, "autoFails": [key], "nbaOk": boolean, "note": "one or two short sentences: the main strength or problem"}',
   ].join('\n');
}

export function scorePrompt({ context = [], message, lead = {}, facts = '', out, expected = {} }) {
   const convo = context.map((m) => `${m.from === 'agent' ? 'Agent' : 'Customer'}: ${m.text}`).join('\n');
   return [
      `BUSINESS FACTS:\n${facts || '(none)'}`,
      convo ? `CONVERSATION:\n${asData(convo, 'conversation')}` : '',
      `LEAD STATE BEFORE: ${JSON.stringify(lead)}`,
      `Customer's message: ${asData(message)}`,
      expected.nba?.length ? `Expected next actions: ${expected.nba.join(', ')}` : '',
      expected.ideal ? `Approved ideal reply (for reference; different words are fine): ${asData(expected.ideal, 'ideal_reply')}` : '',
      expected.mustEscalate ? 'This case must be handed to a person.' : '',
      `Agent chose action: ${out.nba || '(none)'}; handed to a person: ${out.needsHuman ? 'yes' : 'no'}; media: ${out.media.join(', ') || 'none'}`,
      `Agent reply: ${asData(out.reply, 'agent_reply')}`,
   ].filter(Boolean).join('\n\n');
}

/** 0–100 from per-measure scores, by the scorecard's weights. Pure. */
export function weightedScore(scores, rubric) {
   const total = rubric.reduce((s, r) => s + r.weight, 0);
   if (!total) return 0;
   const sum = rubric.reduce((s, r) => s + r.weight * Math.max(0, Math.min(100, Number(scores?.[r.key]) || 0)), 0);
   return Math.round((sum / total) * 10) / 10;
}

const figures = (s) => new Set((String(s ?? '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, '')).filter((n) => n.length > 1));
const DISCOUNT = /\b(discount|% ?off|percent off|special (price|rate|offer)|free (month|week)|waive|promo(tion)?|deal)\b/i;

/**
 * What code can decide for certain, before any model's opinion. Pure.
 *  - a number in the reply found in neither the facts, the approved answers,
 *    the conversation nor the message → invented_price
 *  - a discount or promotion when the facts list none → unauthorized_discount
 *  - a case that must go to a person and did not → no_escalation
 */
export function codeChecks({ out, message, context = [], facts = '', answers = [], mustEscalate = false, maxLength = 700, rules = [] }) {
   const known = new Set([...figures(facts), ...figures(message), ...answers.flatMap((a) => [...figures(a.answer)]), ...context.flatMap((m) => [...figures(m.text)])]);
   const unsupported = [...figures(out.reply)].filter((n) => !known.has(n));
   const fails = [];
   if (unsupported.length) fails.push('invented_price');
   if (DISCOUNT.test(out.reply) && !DISCOUNT.test(facts) && !answers.some((a) => DISCOUNT.test(a.answer))) fails.push('unauthorized_discount');
   if (mustEscalate && !out.needsHuman) fails.push('no_escalation');
   for (const r of rules) if (new RegExp(r.pattern, 'i').test(out.reply) && !fails.includes(r.key)) fails.push(r.key);
   return { autoFails: fails, unsupportedFigures: unsupported, tooLong: out.reply.length > maxLength };
}

const FACTUAL = new Set(['invented_price', 'fabricated_promotion', 'false_claim', 'unauthorized_discount', 'price_range', 'called_monthly', 'unconfirmed_action']);

/**
 * One reply's grade. Pass: no automatic fail, weighted score at or above the
 * pass mark, an acceptable action, and escalated when it had to be. Pure.
 */
export function grade({ p, out, judge, code, scenario = {} }) {
   const known = new Set(p.autoFails.map((a) => a.key));
   const autoFails = [...new Set([...(code?.autoFails || []), ...((judge?.autoFails || []).filter((k) => known.has(k)))])];
   const scores = Object.fromEntries(p.rubric.map((r) => [r.key, Math.max(0, Math.min(100, Math.round(Number(judge?.scores?.[r.key]) || 0)))]));
   const score = judge ? weightedScore(scores, p.rubric) : null;
   const expected = scenario.nba || [];
   const nbaOk = expected.length ? expected.includes(out.nba) || Boolean(judge?.nbaOk && !out.nba) : judge?.nbaOk !== false;
   const escalationOk = scenario.mustEscalate ? out.needsHuman : true;
   const outcomeOf = Object.fromEntries(p.actions.map((a) => [a.key, a.outcome || '']));
   return {
      scores, score, autoFails, nbaOk, escalationOk,
      factualOk: !autoFails.some((k) => FACTUAL.has(k)),
      completed: scenario.outcome ? outcomeOf[out.nba] === scenario.outcome || (scenario.outcome === 'escalation' && out.needsHuman) : null,
      pass: !autoFails.length && score != null && score >= p.passMark && nbaOk && escalationOk,
      note: String(judge?.note || '').slice(0, 300),
      unsupportedFigures: code?.unsupportedFigures || [],
   };
}

/* ---------- a test run and its gates ---------- */

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** A run's numbers from its graded cases. Pure. */
export function summarizeRun(cases) {
   const done = cases.filter((c) => c.grade);
   const core = done.filter((c) => c.core);
   const factual = done.filter((c) => c.factual);
   const esc = done.filter((c) => c.mustEscalate);
   const withOutcome = done.filter((c) => c.grade.completed != null);
   const scored = done.filter((c) => c.grade.score != null);
   const blind = cases.filter((c) => c.blind?.rating);
   return {
      cases: cases.length, completed: done.length, errors: cases.length - done.length,
      passed: done.filter((c) => c.grade.pass).length, passPct: pct(done.filter((c) => c.grade.pass).length, done.length),
      corePct: pct(core.filter((c) => c.grade.pass).length, core.length), core: core.length,
      factualPct: pct(factual.filter((c) => c.grade.factualOk).length, factual.length), factual: factual.length,
      escalationPct: pct(esc.filter((c) => c.grade.escalationOk).length, esc.length), escalation: esc.length,
      completionPct: pct(withOutcome.filter((c) => c.grade.completed).length, withOutcome.length), withOutcome: withOutcome.length,
      autoFails: done.reduce((n, c) => n + c.grade.autoFails.length, 0),
      avgScore: scored.length ? Math.round((scored.reduce((s, c) => s + c.grade.score, 0) / scored.length) * 10) / 10 : null,
      nbaPct: pct(done.filter((c) => c.grade.nbaOk).length, done.length),
      blindRated: blind.length, blindOkPct: pct(blind.filter((c) => ['send', 'minor'].includes(c.blind.rating)).length, blind.length),
   };
}

/** Scenarios that passed in the previous run and fail now. Pure. */
export function regressions(prevCases = [], cases = []) {
   const before = new Map(prevCases.filter((c) => c.grade).map((c) => [String(c.scenario), c.grade.pass]));
   return cases.filter((c) => c.grade && before.get(String(c.scenario)) === true && !c.grade.pass).map((c) => String(c.scenario));
}

/**
 * The graduation gates (Specification §17) against a run. A gate with nothing
 * to measure yet is "pending", never "passed". Pure.
 */
export function gateResults(summary, g, { prev = null, regressed = [] } = {}) {
   const at = (actual, target, more = true) => (actual == null ? 'pending' : (more ? actual >= target : actual <= target) ? 'pass' : 'fail');
   const drop = prev?.avgScore != null && summary.avgScore != null ? Math.round((prev.avgScore - summary.avgScore) * 10) / 10 : null;
   return [
      { key: 'core', label: 'Core scenarios pass', target: `≥ ${g.corePass}%`, actual: summary.corePct, status: at(summary.corePct, g.corePass) },
      { key: 'factual', label: 'Factual accuracy (price, availability, policy, promotion)', target: `${g.factual}%`, actual: summary.factualPct, status: at(summary.factualPct, g.factual) },
      { key: 'autoFails', label: 'Automatic fails', target: `≤ ${g.autoFails}`, actual: summary.completed ? summary.autoFails : null, status: summary.completed ? at(summary.autoFails, g.autoFails, false) : 'pending' },
      { key: 'avgScore', label: 'Average weighted score', target: `≥ ${g.avgScore}`, actual: summary.avgScore, status: at(summary.avgScore, g.avgScore) },
      { key: 'blind', label: 'Blind review: send as-is or minor edit', target: `≥ ${g.blind}% of ${g.blindSample}+`, actual: summary.blindOkPct, status: summary.blindRated < g.blindSample ? 'pending' : at(summary.blindOkPct, g.blind), note: `${summary.blindRated} rated` },
      { key: 'completion', label: 'Reaches the right outcome', target: `≥ ${g.completion}%`, actual: summary.completionPct, status: at(summary.completionPct, g.completion) },
      { key: 'escalation', label: 'Mandatory escalations handed over', target: `${g.escalation}%`, actual: summary.escalationPct, status: at(summary.escalationPct, g.escalation) },
      { key: 'stability', label: 'No regression since the last run', target: `0 newly failing, drop ≤ ${g.maxDrop}`, actual: prev ? regressed.length : null, status: !prev ? 'pending' : !regressed.length && (drop == null || drop <= g.maxDrop) ? 'pass' : 'fail', note: prev ? `${regressed.length} newly failing${drop != null ? `, score ${drop > 0 ? `−${drop}` : `+${-drop}`}` : ''}` : 'first run is the baseline' },
   ];
}

export const allPassed = (gates) => gates.length > 0 && gates.every((x) => x.status === 'pass');

/* ---------- rollout ---------- */

/** Specification §18: sandbox first, then A–E. */
export const STAGES = [
   { key: 'sandbox', label: 'Sandbox', body: 'Tested only here. Nothing reaches customers.' },
   { key: 'shadow', label: 'A · Shadow', body: 'Reads live conversations and drafts, sends nothing. Compare with what staff sent.' },
   { key: 'approval', label: 'B · Human approval', body: 'Drafts every reply; staff approve or edit before sending. Edits become training cases.' },
   { key: 'limited', label: 'C · Limited autonomy', body: 'Sends on its own only for the low-risk intents chosen; everything else is approved.' },
   { key: 'expanded', label: 'D · Expanded autonomy', body: 'Broader conversations, with sampling, alerts and rollback.' },
   { key: 'optimized', label: 'E · Optimised', body: 'Full approved scope, A/B testing within guardrails.' },
];

/**
 * Whether moving to `to` is allowed. Going back is always allowed; shadow
 * sends nothing so needs no gates; anything that touches customers needs
 * the latest test run to pass every gate. Pure.
 */
export function canMoveTo(from, to, gatesPassed) {
   const i = STAGES.findIndex((s) => s.key === from);
   const j = STAGES.findIndex((s) => s.key === to);
   if (j < 0) return { ok: false, error: 'Unknown stage' };
   if (j <= Math.max(i, 1)) return { ok: true };
   if (j > i + 1) return { ok: false, error: 'Move one stage at a time' };
   if (!gatesPassed) return { ok: false, error: 'The latest test run must pass every gate first' };
   return { ok: true };
}
