import { Router } from 'express';
import { MessageTemplate } from '../models/index.js';

const router = Router();

const DEFAULT_TEMPLATES = [
  { key: 'welcome', label: 'Welcome Email', subject: 'Welcome to PurpleBox Storage, @name!', emailBody: 'Dear @name,\n\nWelcome to PurpleBox Storage! Your contract @contractNo has been created.\n\nUnit: @unit\nStart Date: @startDate\n\nThank you for choosing us.\n\nBest regards,\nPurpleBox Team', whatsappBody: 'Hello @name 👋\n\nWelcome to PurpleBox Storage!\nYour contract *@contractNo* is ready.\nUnit: @unit\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@unit', '@startDate', '@endDate', '@phone', '@email'] },
  { key: 'contract_signed', label: 'Contract Signed', subject: 'Contract @contractNo Signed Successfully', emailBody: 'Dear @name,\n\nYour contract @contractNo has been signed successfully.\n\nUnit: @unit\nTerm: @startDate – @endDate\nMonthly Rate: AED @rate\n\nYou can view your signed contract here: @signedDocUrl\n\nThank you,\nPurpleBox Team', whatsappBody: 'Hi @name ✅\n\nYour contract *@contractNo* is now signed and active.\nUnit: @unit\nTerm: @startDate → @endDate\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@unit', '@startDate', '@endDate', '@rate', '@signedDocUrl'] },
  { key: 'payment_received', label: 'Payment Received', subject: 'Payment Received – @invoiceNo', emailBody: 'Dear @name,\n\nWe have received your payment of AED @amount for invoice @invoiceNo.\n\nContract: @contractNo\nPayment Method: @method\nDate: @paidDate\n\nThank you,\nPurpleBox Team', whatsappBody: 'Hi @name ✅\n\nPayment of *AED @amount* received for invoice *@invoiceNo*.\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@invoiceNo', '@amount', '@method', '@paidDate'] },
  { key: 'payment_reminder', label: 'Payment Pending Reminder', subject: 'Payment Reminder – @invoiceNo', emailBody: 'Dear @name,\n\nThis is a reminder that your payment of AED @amount for invoice @invoiceNo is due on @dueDate.\n\nContract: @contractNo\nUnit: @unit\n\nPlease arrange payment at your earliest convenience.\n\nThank you,\nPurpleBox Team', whatsappBody: 'Hello @name,\n\nThis is a reminder that your payment of *AED @amount* is due on *@dueDate*.\n\nContract: @contractNo\n\nPlease get in touch with us.\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@invoiceNo', '@amount', '@dueDate', '@unit'] },
  { key: 'contract_expiring', label: 'Contract Expiring Reminder', subject: 'Your Contract @contractNo is Expiring Soon', emailBody: 'Dear @name,\n\nYour storage contract @contractNo for Unit @unit is expiring on @endDate.\n\nIf you wish to renew, please contact us.\n\nThank you,\nPurpleBox Team', whatsappBody: 'Hello @name,\n\nYour contract *@contractNo* (Unit @unit) expires on *@endDate*.\n\nPlease contact us to renew.\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@unit', '@endDate', '@daysLeft'] },
  /* Sent on or after the expiry date itself, to a tenant who neither renewed
   * nor gave notice — a different moment from contract_expiring above, which
   * is the earlier "let us know your plans" nudge. Kept as its own template
   * rather than an edit to that one so the two can be sent independently. The
   * fee figures (AED 250 / AED 500 / 7 days) are fixed policy wording, not
   * per-contract data, so they are written in rather than templated. */
  { key: 'contract_auto_renewed', label: 'Contract Auto-Renewed (No Notice)', subject: 'Your contract @contractNo has renewed automatically', emailBody: 'Dear @name,\n\nYour storage contract with PurpleBox Storage for unit @unit reached its renewal date today, @endDate.\n\nAs we did not receive a vacate notice, your contract has renewed automatically for a further 4 weeks at your current monthly rate of AED @rate, running until @newEndDate.\n\nPayment due\nPlease make your payment of AED @rate today, @endDate, if you have not already done so.\n\nChanged your mind?\nIf you intended to vacate, please contact us immediately so we can arrange your move-out and return of the key/access device.\n\nLate payment and default fees\nIf the renewal payment is not received by @endDate, a late fee of @lateFee will apply from that date until the outstanding balance is settled.\n\nIf payment remains unpaid for seven (7) calendar days after the due date, PurpleBox may charge a further late/default administrative fee of AED 250. Where the default requires enhanced collection, inventory, access-control, account administration or enforcement work, PurpleBox may charge an additional default administration fee of up to AED 500, reflecting reasonable administrative costs actually associated with the default. Any agreed compensation remains subject to adjustment by a competent court where required by mandatory UAE law.\n\nThank you for storing with PurpleBox.', whatsappBody: 'Dear @name,\n\nYour contract *@contractNo* (Unit @unit) reached its renewal date today, @endDate, and has renewed automatically for 4 more weeks at AED @rate, running until @newEndDate.\n\nPlease pay AED @rate today if you have not already. A late fee of @lateFee applies from @endDate if unpaid.\n\nIntended to vacate instead? Contact us immediately.\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@unit', '@endDate', '@newEndDate', '@rate', '@lateFee'] },
  { key: 'contract_ended', label: 'Contract Ended', subject: 'Contract @contractNo Has Ended', emailBody: 'Dear @name,\n\nYour contract @contractNo for Unit @unit has ended as of @endDate.\n\nPlease ensure all belongings have been removed. Your deposit will be processed as per terms.\n\nThank you for storing with us.\n\nBest regards,\nPurpleBox Team', whatsappBody: 'Hello @name,\n\nYour contract *@contractNo* has ended.\nUnit @unit is now released.\n\nThank you for choosing PurpleBox!', variables: ['@name', '@contractNo', '@unit', '@endDate'] },
];

// Starter quick replies for the WhatsApp console. Deliberately generic —
// anything with an address, a price or an opening time would be inventing
// facts about the business, so those are left for staff to fill in.
const DEFAULT_QUICK_REPLIES = [
  { key: 'qr_greeting', label: 'Greeting', category: 'Greeting / intro', sortOrder: 10,
    whatsappBody: 'Hello! Thanks for contacting PurpleBox Storage. How can we help you today?' },
  { key: 'qr_intro', label: 'Who we are', category: 'Greeting / intro', sortOrder: 20,
    whatsappBody: 'We provide clean, secure self-storage units with flexible terms. Tell us roughly how much you need to store and we will suggest a size.' },
  { key: 'qr_sizes', label: 'Ask what they need', category: 'Unit sizes & pricing', sortOrder: 30,
    whatsappBody: 'Could you tell us what you are planning to store and for how long? We will recommend the right unit size and share the price.' },
  { key: 'qr_availability', label: 'Checking availability', category: 'Availability check', sortOrder: 40,
    whatsappBody: 'Let me check availability for those dates and come back to you shortly.' },
  /* Sends WhatsApp's own pin, then the address as text.
   *
   * Deliberately not a Google Maps link: that opens a search page listing
   * every storage place nearby, which is a poor way to hand a customer to a
   * competitor. The pin opens on our door and nothing else. */
  { key: 'qr_location', label: 'Location', category: 'Location & directions', sortOrder: 50,
    whatsappBody: 'Our address is: ABA Avenue – Unit 12, 12th St, Al Quoz 2, Dubai. Let us know when you would like to visit.',
    mediaKind: 'location',
    locationLat: 25.1236443,
    locationLng: 55.2439481,
    locationName: 'PurpleBox Storage',
    locationAddress: 'ABA Avenue – Unit 12, 12th St, Al Quoz 2, Dubai' },
  { key: 'qr_booking', label: 'Booking confirmed', category: 'Booking confirmation', sortOrder: 60,
    whatsappBody: 'Your booking is confirmed. We will send the agreement shortly — please review and sign it, and let us know if anything needs changing.' },
  { key: 'qr_followup', label: 'Following up', category: 'Follow-up / no reply', sortOrder: 70,
    whatsappBody: 'Just following up on your enquiry — is there anything else you would like to know before deciding?' },
  { key: 'qr_moving', label: 'Moving service', category: 'Packing & moving service', sortOrder: 80,
    whatsappBody: 'We can also arrange packing and moving. Tell us the pickup address and roughly what needs moving, and we will send a quote.' },
];

/**
 * Add whichever DEFAULT rows this database is still missing, by key.
 *
 * Not "insert the defaults if the collection is empty" — that only ever ran
 * once, on a fresh install, so a template added to the code later (like
 * contract_auto_renewed) would never reach a database that already had rows
 * in it. This runs every time and only ever adds what is missing: an
 * existing row, including one somebody has since edited, is never touched.
 */
async function ensureDefaults(defaults, extra) {
  const existingKeys = new Set((await MessageTemplate.find({}).select('key').lean()).map((t) => t.key));
  const missing = defaults.filter((t) => !existingKeys.has(t.key));
  if (missing.length) {
    await MessageTemplate.insertMany(missing.map((t) => ({ ...extra, ...t })));
  }
}

// Get templates. ?kind=quick_reply returns the WhatsApp canned replies;
// anything else returns the contract/automation ones. Each set seeds itself
// on first request so a fresh install is not empty, and stays seeded as new
// defaults are added later.
router.get('/', async (req, res) => {
  const kind = req.query.kind === 'quick_reply' ? 'quick_reply' : 'automation';

  if (kind === 'quick_reply') {
    await ensureDefaults(DEFAULT_QUICK_REPLIES, { kind: 'quick_reply', subject: '', emailBody: '', variables: [] });
    const quick = await MessageTemplate.find({ kind: 'quick_reply' }).sort({ sortOrder: 1, label: 1 });
    return res.json(quick);
  }

  await ensureDefaults(DEFAULT_TEMPLATES, {});
  // Existing rows predate the kind field, so treat a missing value as
  // 'automation' rather than hiding them.
  const templates = await MessageTemplate.find({ kind: { $ne: 'quick_reply' } }).sort({ key: 1 });
  res.json(templates);
});

// Update a template
router.put('/:id', async (req, res) => {
  const { subject, emailBody, emailHtml, whatsappBody, label, category, sortOrder, mediaUrl, mediaKind, mediaFilename,
    whatsappTemplate, whatsappTemplateLang, whatsappTemplateVars,
    locationLat, locationLng, locationName, locationAddress } = req.body;
  const update = { subject, emailBody, whatsappBody };

  /* The Meta-approved name, if this template has one.
   *
   * Trimmed and stripped of a leading @ on each variable, because the rest of
   * the app writes them that way and a mapping of "@name" would look up a
   * variable that does not exist and send an empty placeholder. */
  if (whatsappTemplate !== undefined) update.whatsappTemplate = String(whatsappTemplate || '').trim();
  if (whatsappTemplateLang !== undefined) update.whatsappTemplateLang = String(whatsappTemplateLang || 'en').trim() || 'en';
  if (whatsappTemplateVars !== undefined) {
    const raw = Array.isArray(whatsappTemplateVars)
      ? whatsappTemplateVars
      : String(whatsappTemplateVars || '').split(',');
    update.whatsappTemplateVars = raw.map((v) => String(v).trim().replace(/^@/, '')).filter(Boolean);
  }
  // The designed version, sent in preference to the text when present.
  if (emailHtml !== undefined) update.emailHtml = String(emailHtml || '');
  if (label) update.label = label;
  if (category !== undefined) update.category = String(category);
  if (sortOrder !== undefined && Number.isFinite(Number(sortOrder))) update.sortOrder = Number(sortOrder);
  // A quick reply's attachment. Only http(s) is accepted — Meta fetches this
  // URL itself, so anything it cannot reach would fail at send time instead.
  if (mediaKind !== undefined) {
    const kind = String(mediaKind || '');
    if (!['', 'image', 'video', 'audio', 'document', 'location'].includes(kind)) {
      return res.status(400).json({ error: 'mediaKind must be image, video, audio, document, location or empty' });
    }
    update.mediaKind = kind;
  }
  if (mediaUrl !== undefined) {
    const url = String(mediaUrl || '').trim();
    if (url && !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'The file URL must start with http:// or https://' });
    }
    update.mediaUrl = url;
  }
  if (mediaFilename !== undefined) update.mediaFilename = String(mediaFilename || '');

  /* A 'location' quick reply carries coordinates instead of a file URL — see
   * the model comment for why that beats a Maps link. Validated as real
   * latitude/longitude here rather than trusted, since a bad pin only shows
   * up when a customer taps it in the field. */
  if (locationLat !== undefined) {
    const lat = locationLat === '' || locationLat === null ? null : Number(locationLat);
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
      return res.status(400).json({ error: 'Latitude must be a number between -90 and 90' });
    }
    update.locationLat = lat;
  }
  if (locationLng !== undefined) {
    const lng = locationLng === '' || locationLng === null ? null : Number(locationLng);
    if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
      return res.status(400).json({ error: 'Longitude must be a number between -180 and 180' });
    }
    update.locationLng = lng;
  }
  if (locationName !== undefined) update.locationName = String(locationName || '').trim();
  if (locationAddress !== undefined) update.locationAddress = String(locationAddress || '').trim();
  const template = await MessageTemplate.findByIdAndUpdate(
    req.params.id,
    update,
    { new: true }
  );
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json(template);
});

// Create a new custom template
router.post('/', async (req, res) => {
  try {
    const { key, label, subject, emailBody, whatsappBody, variables, kind, category, sortOrder } = req.body;
    if (!key || !label) return res.status(400).json({ error: 'key and label are required' });
    const existing = await MessageTemplate.findOne({ key });
    if (existing) return res.status(409).json({ error: 'Template with this key already exists' });
    const template = await MessageTemplate.create({
      kind: kind === 'quick_reply' ? 'quick_reply' : 'automation',
      category: String(category || ''),
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      key, label, subject: subject || '', emailBody: emailBody || '',
      whatsappBody: whatsappBody || '', variables: variables || ['@name', '@amount', '@unit', '@dueDate', '@contractNo'],
    });
    res.status(201).json(template);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a custom template
router.delete('/:id', async (req, res) => {
  try {
    const template = await MessageTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const isDefault = DEFAULT_TEMPLATES.some(d => d.key === template.key);
    if (isDefault) return res.status(400).json({ error: 'Cannot delete built-in templates' });
    await template.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reset a template to default
router.post('/:key/reset', async (req, res) => {
  const def = DEFAULT_TEMPLATES.find(t => t.key === req.params.key);
  if (!def) return res.status(404).json({ error: 'Unknown template key' });
  const template = await MessageTemplate.findOneAndUpdate(
    { key: req.params.key },
    { subject: def.subject, emailBody: def.emailBody, whatsappBody: def.whatsappBody },
    { new: true, upsert: true }
  );
  res.json(template);
});

export default router;
