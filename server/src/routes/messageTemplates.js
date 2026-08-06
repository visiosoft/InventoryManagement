import { Router } from 'express';
import { MessageTemplate } from '../models/index.js';

const router = Router();

const DEFAULT_TEMPLATES = [
  { key: 'welcome', label: 'Welcome Email', subject: 'Welcome to PurpleBox Storage, @name!', emailBody: 'Dear @name,\n\nWelcome to PurpleBox Storage! Your contract @contractNo has been created.\n\nUnit: @unit\nStart Date: @startDate\n\nThank you for choosing us.\n\nBest regards,\nPurpleBox Team', whatsappBody: 'Hello @name 👋\n\nWelcome to PurpleBox Storage!\nYour contract *@contractNo* is ready.\nUnit: @unit\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@unit', '@startDate', '@endDate', '@phone', '@email'] },
  { key: 'contract_signed', label: 'Contract Signed', subject: 'Contract @contractNo Signed Successfully', emailBody: 'Dear @name,\n\nYour contract @contractNo has been signed successfully.\n\nUnit: @unit\nTerm: @startDate – @endDate\nMonthly Rate: AED @rate\n\nYou can view your signed contract here: @signedDocUrl\n\nThank you,\nPurpleBox Team', whatsappBody: 'Hi @name ✅\n\nYour contract *@contractNo* is now signed and active.\nUnit: @unit\nTerm: @startDate → @endDate\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@unit', '@startDate', '@endDate', '@rate', '@signedDocUrl'] },
  { key: 'payment_received', label: 'Payment Received', subject: 'Payment Received – @invoiceNo', emailBody: 'Dear @name,\n\nWe have received your payment of AED @amount for invoice @invoiceNo.\n\nContract: @contractNo\nPayment Method: @method\nDate: @paidDate\n\nThank you,\nPurpleBox Team', whatsappBody: 'Hi @name ✅\n\nPayment of *AED @amount* received for invoice *@invoiceNo*.\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@invoiceNo', '@amount', '@method', '@paidDate'] },
  { key: 'payment_reminder', label: 'Payment Pending Reminder', subject: 'Payment Reminder – @invoiceNo', emailBody: 'Dear @name,\n\nThis is a reminder that your payment of AED @amount for invoice @invoiceNo is due on @dueDate.\n\nContract: @contractNo\nUnit: @unit\n\nPlease arrange payment at your earliest convenience.\n\nThank you,\nPurpleBox Team', whatsappBody: 'Hello @name,\n\nThis is a reminder that your payment of *AED @amount* is due on *@dueDate*.\n\nContract: @contractNo\n\nPlease get in touch with us.\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@invoiceNo', '@amount', '@dueDate', '@unit'] },
  { key: 'contract_expiring', label: 'Contract Expiring Reminder', subject: 'Your Contract @contractNo is Expiring Soon', emailBody: 'Dear @name,\n\nYour storage contract @contractNo for Unit @unit is expiring on @endDate.\n\nIf you wish to renew, please contact us.\n\nThank you,\nPurpleBox Team', whatsappBody: 'Hello @name,\n\nYour contract *@contractNo* (Unit @unit) expires on *@endDate*.\n\nPlease contact us to renew.\n\nThank you – PurpleBox', variables: ['@name', '@contractNo', '@unit', '@endDate', '@daysLeft'] },
  { key: 'contract_ended', label: 'Contract Ended', subject: 'Contract @contractNo Has Ended', emailBody: 'Dear @name,\n\nYour contract @contractNo for Unit @unit has ended as of @endDate.\n\nPlease ensure all belongings have been removed. Your deposit will be processed as per terms.\n\nThank you for storing with us.\n\nBest regards,\nPurpleBox Team', whatsappBody: 'Hello @name,\n\nYour contract *@contractNo* has ended.\nUnit @unit is now released.\n\nThank you for choosing PurpleBox!', variables: ['@name', '@contractNo', '@unit', '@endDate'] },
];

// Get all templates (seed defaults if empty)
router.get('/', async (_req, res) => {
  let templates = await MessageTemplate.find().sort({ key: 1 });
  if (templates.length === 0) {
    templates = await MessageTemplate.insertMany(DEFAULT_TEMPLATES);
  }
  res.json(templates);
});

// Update a template
router.put('/:id', async (req, res) => {
  const { subject, emailBody, whatsappBody, label } = req.body;
  const update = { subject, emailBody, whatsappBody };
  if (label) update.label = label;
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
    const { key, label, subject, emailBody, whatsappBody, variables } = req.body;
    if (!key || !label) return res.status(400).json({ error: 'key and label are required' });
    const existing = await MessageTemplate.findOne({ key });
    if (existing) return res.status(409).json({ error: 'Template with this key already exists' });
    const template = await MessageTemplate.create({
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
