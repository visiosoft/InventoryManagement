/**
 * Starter scenarios for the self-storage sales playbook, across the test
 * matrix of the PurpleBox specification (§15). Each one fixes the situation
 * and the acceptable Next Best Actions; the ideal reply is left for the
 * business to write or approve (§23 step 3), so nothing here claims to be
 * PurpleBox's approved wording. Pure data.
 *
 *   c  conversation before this message, alternating customer / agent
 *   l  lead state before
 *   f  a factual case (price, availability, policy, promotion)
 *   e  must be handed to a person
 *   o  the outcome a good reply moves toward
 */

const C = (...lines) => lines.map((text, i) => ({ from: i % 2 ? 'agent' : 'customer', text }));

const RAW = [
   // Pricing
   ['pricing', 'General price question', 'Hi, how much is storage?', { intent: 'Price range', nba: ['ask_discovery', 'give_price'], f: 1 }],
   ['pricing', 'Exact size price', 'What is the price for a 50 sq ft unit?', { intent: 'Specific unit price', nba: ['give_price'], f: 1 }],
   ['pricing', 'Smallest unit price', 'What\'s your cheapest unit?', { intent: 'Lowest price', nba: ['give_price', 'ask_discovery'], f: 1 }],
   ['pricing', 'Budget-sensitive', 'I only have about 300 a month, what can I get?', { intent: 'Fit to budget', nba: ['recommend_size', 'ask_discovery', 'give_price'], f: 1, l: { price_sensitivity: 'high' } }],
   ['pricing', 'Competitor quote', 'Another place quoted me less for 75 sq ft. Can you match?', { intent: 'Price match', nba: ['handle_objection', 'escalate'], f: 1, l: { estimated_size: '75', competitor: 'quote' } }],
   ['pricing', 'Promotion request', 'Do you have any offers or discounts right now?', { intent: 'Promotion', nba: ['give_price', 'ask_discovery', 'explain_feature'], f: 1 }],
   ['pricing', 'Monthly vs 4-weekly', 'Is the price per month or per 4 weeks?', { intent: 'Billing period', nba: ['give_price', 'explain_feature'], f: 1 }],
   ['pricing', 'Long-stay price', 'If I take it for a year is it cheaper?', { intent: 'Long-term price', nba: ['give_price', 'escalate', 'ask_discovery'], f: 1 }],
   ['pricing', 'Price after recommendation', 'Ok 75 sounds right, how much is it?', { c: C('I need to store a 1-bed flat for 3 months', 'For a 1-bedroom flat I\'d start with about 75 sq ft. Want me to check the price?'), intent: 'Price of recommended size', nba: ['give_price'], f: 1, l: { items: '1-bed flat', estimated_size: '75', duration: '3 months' } }],
   ['pricing', 'Price with VAT', 'Does the price include VAT?', { intent: 'Tax', nba: ['give_price', 'explain_feature', 'escalate'], f: 1 }],
   // Sizing
   ['sizing', 'Boxes only', 'I have around 20 boxes, what size do I need?', { intent: 'Size for boxes', nba: ['recommend_size'] }],
   ['sizing', 'Studio furniture', 'Moving out of a studio, bed, sofa, fridge and some boxes', { intent: 'Size for studio', nba: ['recommend_size'] }],
   ['sizing', 'Villa contents', 'Need to store a 4 bedroom villa', { intent: 'Size for villa', nba: ['recommend_size', 'ask_discovery', 'invite_visit'] }],
   ['sizing', 'Office files', 'We have 40 archive boxes of company files', { intent: 'Size for documents', nba: ['recommend_size'] }],
   ['sizing', 'Business inventory', 'I sell clothes online and have about 3 pallets of stock', { intent: 'Size for inventory', nba: ['recommend_size', 'ask_discovery'] }],
   ['sizing', 'Uncertain volume', 'I don\'t really know how much stuff I have', { intent: 'Unsure of size', nba: ['ask_discovery', 'send_unit_media', 'invite_visit'] }],
   ['sizing', 'Asks for larger than needed', 'Give me 200 sq ft, I only have a few boxes and a bike', { intent: 'Oversizing', nba: ['recommend_size'] }],
   ['sizing', 'Size in metres', 'How big is 50 sq ft in metres? Will a king bed fit?', { intent: 'Size conversion', nba: ['recommend_size', 'send_unit_media'] }],
   // Personal use
   ['personal', 'Moving house', 'We are moving next month and the new place isn\'t ready', { intent: 'Moving gap', nba: ['ask_discovery'] }],
   ['personal', 'Renovation', 'Renovating the kitchen and living room for 2 months', { intent: 'Renovation', nba: ['ask_discovery', 'recommend_size'] }],
   ['personal', 'Travelling', 'I\'m going abroad for 6 months, need to keep my things safe', { intent: 'Travel', nba: ['ask_discovery', 'explain_feature'] }],
   ['personal', 'Decluttering', 'Just need to clear some space at home, seasonal stuff and a few chairs', { intent: 'Decluttering', nba: ['recommend_size', 'ask_discovery'] }],
   ['personal', 'Gap between homes', 'Lease ends on the 1st, new one starts on the 20th', { intent: 'Short gap', nba: ['ask_discovery', 'recommend_size'] }],
   // Business use
   ['business', 'E-commerce stock', 'I run a small e-commerce shop and need to pick orders daily', { intent: 'Frequent-access stock', nba: ['ask_discovery', 'explain_feature'] }],
   ['business', 'Documents archive', 'Our company needs to keep files for 5 years', { intent: 'Archive', nba: ['ask_discovery', 'recommend_size'] }],
   ['business', 'Equipment', 'We have event equipment, speakers and stands', { intent: 'Equipment storage', nba: ['ask_discovery', 'recommend_size'] }],
   ['business', 'Frequent access', 'Can my staff come in every day at 6am?', { intent: 'Access hours', nba: ['explain_feature'], f: 1 }],
   ['business', 'Expansion', 'We might need more space in a few months, can we add units?', { intent: 'Growth', nba: ['explain_feature', 'ask_discovery'] }],
   ['business', 'Two product categories', 'I want to keep cosmetics separate from packaging', { intent: 'Combined units', nba: ['recommend_size', 'explain_feature'] }],
   // Facility
   ['facility', 'Cleanliness', 'Is the place clean? Last storage I used had dust everywhere', { intent: 'Cleanliness', nba: ['explain_feature', 'send_facility_tour', 'invite_visit'] }],
   ['facility', 'Temperature control', 'Is it air conditioned? I have wooden furniture', { intent: 'Climate', nba: ['explain_feature'], f: 1 }],
   ['facility', '24/7 access', 'Can I come at night?', { intent: 'Access hours', nba: ['explain_feature'], f: 1 }],
   ['facility', 'Location', 'Where are you located exactly?', { intent: 'Location', nba: ['explain_feature', 'invite_visit'], f: 1 }],
   ['facility', 'Security', 'How secure is it? Do you have cameras?', { intent: 'Security', nba: ['explain_feature', 'send_facility_tour'], f: 1 }],
   ['facility', 'Wants to see it', 'Can I see the units before I decide?', { intent: 'Visit request', nba: ['invite_visit', 'book_visit'], o: 'visit' }],
   ['facility', 'Insurance', 'Are my things insured?', { intent: 'Insurance', nba: ['explain_feature', 'escalate'], f: 1 }],
   // Objections
   ['objections', 'Too expensive', 'That\'s too expensive', { c: C('How much is 50 sq ft?', 'Our 50 sq ft unit is [price] per 4 weeks…'), intent: 'Price objection', nba: ['handle_objection', 'ask_discovery'], l: { estimated_size: '50' } }],
   ['objections', 'Competitor cheaper', 'X storage is cheaper', { intent: 'Competitor objection', nba: ['handle_objection', 'invite_visit'], l: { competitor: 'named' } }],
   ['objections', 'Need to think', 'Let me think about it', { c: C('What would 75 sq ft cost?', 'Our 75 sq ft unit is [price]…'), intent: 'Stalling', nba: ['handle_objection', 'invite_visit'], o: 'visit' }],
   ['objections', 'Not sure of size', 'I\'m not sure which size, I don\'t want to pay for space I don\'t use', { intent: 'Size uncertainty', nba: ['ask_discovery', 'send_unit_media', 'recommend_size'] }],
   ['objections', 'Too far', 'Al Quoz is a bit far from me', { intent: 'Distance', nba: ['handle_objection', 'ask_discovery'] }],
   ['objections', 'Spouse approval', 'I need to check with my wife first', { intent: 'Decision maker', nba: ['handle_objection', 'schedule_follow_up'], o: 'follow_up' }],
   ['objections', 'Boss approval', 'My manager has to approve the budget', { intent: 'Business approval', nba: ['handle_objection', 'schedule_follow_up'], o: 'follow_up' }],
   ['objections', 'Not needed yet', 'I won\'t need it until January', { intent: 'Later timing', nba: ['schedule_follow_up'], o: 'follow_up' }],
   ['objections', 'Just checking prices', 'Just checking prices for now', { intent: 'Browsing', nba: ['give_price', 'ask_discovery'], f: 1 }],
   ['objections', 'Distrust', 'I don\'t really trust storage places with my things', { intent: 'Trust', nba: ['handle_objection', 'send_facility_tour', 'invite_visit'] }],
   ['objections', 'Commitment', 'I don\'t want to be locked into a long contract', { intent: 'Commitment', nba: ['explain_feature', 'handle_objection'], f: 1 }],
   ['objections', 'Price + distance', 'It\'s more expensive and further than the one near me', { intent: 'Two objections', nba: ['handle_objection', 'invite_visit'] }],
   ['objections', 'Asks for discount after value', 'I like it but can you do a better price?', { c: C('Is it clean and air conditioned?', 'Yes — it\'s temperature controlled and cleaned daily…', 'And the price for 50?', 'Our 50 sq ft unit is [price]…'), intent: 'Discount request', nba: ['handle_objection', 'offer_incentive', 'escalate'], l: { estimated_size: '50', buying_intent: 'medium', primary_objection: 'price' } }],
   // Closing
   ['closing', 'How to pay', 'How do I pay?', { c: C('I need 50 sq ft from Saturday', 'Great, 50 sq ft is [price]…'), intent: 'Payment', nba: ['reserve'], o: 'booking', l: { estimated_size: '50', start_date: 'Saturday', buying_intent: 'high' } }],
   ['closing', 'Is it available', 'Is 75 available this week?', { intent: 'Availability', nba: ['reserve', 'give_price'], f: 1, o: 'booking' }],
   ['closing', 'Documents needed', 'What documents do you need from me?', { intent: 'Documents', nba: ['reserve', 'explain_feature'], f: 1, o: 'booking' }],
   ['closing', 'Immediate move-in', 'I need it today, I\'m coming with a truck in 2 hours', { intent: 'Urgent move-in', nba: ['reserve', 'book_visit'], o: 'booking' }],
   ['closing', 'Visit tomorrow', 'Ok I can come tomorrow', { c: C('Would you like to see the facility?'), intent: 'Accepts visit', nba: ['book_visit'], o: 'visit' }],
   ['closing', 'Reserve remotely', 'I\'m abroad, can I reserve without visiting?', { intent: 'Remote reservation', nba: ['reserve'], o: 'booking' }],
   // Follow-up
   ['follow_up', 'Comes back later', 'Hi again, I spoke to you last week about 50 sq ft', { intent: 'Returning lead', nba: ['give_price', 'invite_visit', 'reserve'], l: { estimated_size: '50', media_actions: 'quote sent' } }],
   ['follow_up', 'Future date', 'Can you remind me at the end of the month?', { intent: 'Follow-up request', nba: ['schedule_follow_up'], o: 'follow_up' }],
   ['follow_up', 'After silence', 'Sorry for the late reply, still interested', { c: C('Would today or tomorrow be easier to visit?'), intent: 'Re-engaged', nba: ['invite_visit', 'book_visit'], o: 'visit' }],
   ['follow_up', 'Decision maker away', 'My partner is travelling, will decide when he is back next week', { intent: 'Decision delayed', nba: ['schedule_follow_up'], o: 'follow_up' }],
   // Edge cases
   ['edge', 'Unsupported request', 'Can I store my car with you?', { intent: 'Out of scope', nba: ['explain_feature', 'escalate'], f: 1 }],
   ['edge', 'Unclear message', 'hi ??', { intent: 'Unclear', nba: ['ask_discovery'] }],
   ['edge', 'Arabic message', 'كم سعر الوحدة الصغيرة؟', { intent: 'Price (Arabic)', nba: ['give_price', 'ask_discovery'], f: 1 }],
   ['edge', 'Unit unavailable', 'I want exactly 35 sq ft, nothing else', { intent: 'Specific size', nba: ['give_price', 'reserve', 'recommend_size'], f: 1 }],
   ['edge', 'Hazardous goods', 'Can I store paint and gas cylinders?', { intent: 'Prohibited goods', nba: ['explain_feature', 'escalate'], f: 1 }],
   ['edge', 'Food items', 'I want to keep rice bags and food stock', { intent: 'Food storage', nba: ['explain_feature', 'escalate'], f: 1 }],
   ['edge', 'Asks to be a person', 'Can I speak to a real person?', { intent: 'Human request', nba: ['escalate'], e: 1, o: 'escalation' }],
   // Escalation
   ['escalation', 'Complaint', 'My unit was left open and I\'m very upset', { intent: 'Complaint', nba: ['escalate'], e: 1, o: 'escalation' }],
   ['escalation', 'Legal threat', 'If my items are damaged I will take legal action', { intent: 'Legal', nba: ['escalate'], e: 1, o: 'escalation' }],
   ['escalation', 'Big discount', 'I\'ll take 3 large units for a year if you give me 40% off', { intent: 'Exceptional discount', nba: ['escalate'], e: 1, f: 1, o: 'escalation' }],
   ['escalation', 'Refund', 'I want a refund for last month', { intent: 'Refund', nba: ['escalate'], e: 1, o: 'escalation' }],
   ['escalation', 'Billing dispute', 'You charged me twice this month', { intent: 'Billing dispute', nba: ['escalate'], e: 1, o: 'escalation' }],
   ['escalation', 'Unusual goods', 'Can I store expensive artwork worth 500k?', { intent: 'High-value goods', nba: ['escalate', 'explain_feature'], e: 1, o: 'escalation' }],
   ['escalation', 'Policy uncertainty', 'Can I sublet my unit to a friend?', { intent: 'Policy question', nba: ['escalate'], e: 1, o: 'escalation' }],
   ['escalation', 'Lost access', 'I lost my access card and need to get in now', { intent: 'Access problem', nba: ['escalate'], e: 1, o: 'escalation' }],
];

/** The starter set as scenario documents (drafts). Pure. */
export function storageSeeds() {
   return RAW.map(([group, title, message, x]) => ({
      group, title, message, context: x.c || [], leadBefore: x.l || {}, intent: x.intent, nba: x.nba,
      mustEscalate: Boolean(x.e), factual: Boolean(x.f), core: true, outcome: x.o || '', source: 'seed', status: 'draft',
      tags: [group, ...(x.f ? ['factual'] : []), ...(x.e ? ['escalation'] : [])],
   }));
}
