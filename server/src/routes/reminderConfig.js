import { Router } from 'express';
import { ReminderConfig, ReminderLog, Payment } from '../models/index.js';
import { runPaymentReminders } from '../services/paymentReminders.js';

const router = Router();

const DEFAULT_STAGES = [
  { name: 'Friendly Reminder', daysBeforeDue: 15, frequencyDays: 5, channel: 'both', message: 'Dear {{name}}, this is a friendly reminder that your storage payment of AED {{amount}} for Unit {{unit}} is due on {{dueDate}}. Please arrange payment at your earliest convenience. Thank you, PurpleBox Storage.' },
  { name: 'Payment Reminder', daysBeforeDue: 7, frequencyDays: 3, channel: 'both', message: 'Dear {{name}}, your storage payment of AED {{amount}} for Unit {{unit}} is due in {{daysLeft}} day(s) on {{dueDate}}. Please ensure payment is made on time to avoid any service interruption. Thank you, PurpleBox Storage.' },
  { name: 'Urgent Reminder', daysBeforeDue: 3, frequencyDays: 1, channel: 'both', message: 'URGENT: Dear {{name}}, your payment of AED {{amount}} for Unit {{unit}} is due in {{daysLeft}} day(s) on {{dueDate}}. Immediate action is required to avoid access restrictions. Please contact us now. PurpleBox Storage.' },
  { name: 'Overdue Notice', daysBeforeDue: 0, frequencyDays: 1, channel: 'both', message: 'OVERDUE NOTICE: Dear {{name}}, your payment of AED {{amount}} for Unit {{unit}} was due on {{dueDate}} and is now overdue. Your access to the unit may be restricted. Please make payment immediately or contact us. PurpleBox Storage.' },
  { name: 'Final Vacate Notice', daysBeforeDue: -7, frequencyDays: 1, channel: 'both', message: 'FINAL NOTICE: Dear {{name}}, your account for Unit {{unit}} is severely overdue (AED {{amount}} due {{dueDate}}). This is your final notice. Please vacate the unit within 7 days or make full payment immediately. Failure to comply may result in legal action. PurpleBox Storage.' },
];

// GET /api/reminder-config
router.get('/', async (_req, res) => {
  try {
    let config = await ReminderConfig.findOne();
    if (!config) config = await ReminderConfig.create({ stages: DEFAULT_STAGES });
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/reminder-config
router.put('/', async (req, res) => {
  try {
    let config = await ReminderConfig.findOne();
    if (!config) {
      config = await ReminderConfig.create(req.body);
    } else {
      Object.assign(config, req.body);
      await config.save();
    }
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reminder-config/logs
router.get('/logs', async (req, res) => {
  try {
    const { contract, payment, limit = 50, skip = 0 } = req.query;
    const filter = {};
    if (contract) filter.contract = contract;
    if (payment) filter.payment = payment;
    const logs = await ReminderLog.find(filter)
      .sort({ sentAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit))
      .populate('customer', 'fullName')
      .lean();
    const total = await ReminderLog.countDocuments(filter);
    res.json({ logs, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reminder-config/test/:paymentId  — force-send ignoring frequency check
router.post('/test/:paymentId', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId).populate({
      path: 'contract',
      match: { status: 'active' },
      populate: [{ path: 'customer' }, { path: 'unit' }, { path: 'units' }],
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (!payment.contract) return res.status(400).json({ error: 'No active contract for this payment' });

    const config = await ReminderConfig.findOne();
    if (!config || config.stages.length === 0) return res.status(400).json({ error: 'No reminder config found' });

    const { sendWhatsAppText } = await import('../services/whatsapp.js');
    const { sendEmail, emailConfigured } = await import('../services/emailService.js');

    const contract = payment.contract;
    const customer = contract.customer;
    const unit = contract.units?.length > 1
      ? contract.units.map((u) => u.unitNumber).join(', ')
      : (contract.unit?.unitNumber ?? '—');

    const now = new Date();
    const daysLeft = Math.ceil((new Date(payment.dueDate).getTime() - now.getTime()) / 86400000);

    const applicable = config.stages.filter((s) => s.daysBeforeDue >= daysLeft);
    applicable.sort((a, b) => a.daysBeforeDue - b.daysBeforeDue);
    const stage = applicable[0] || config.stages[config.stages.length - 1];
    const stageIdx = config.stages.indexOf(stage);

    const vars = {
      name: customer.fullName,
      amount: Number(payment.amount).toFixed(2),
      unit,
      dueDate: new Date(payment.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      daysLeft: String(Math.max(0, daysLeft)),
    };
    const message = stage.message.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

    const phone = (customer.phones?.[0] || customer.phone || '').replace(/\s+/g, '');
    const email = customer.email || '';
    const results = [];

    if (config.whatsappEnabled && ['both', 'whatsapp'].includes(stage.channel) && phone) {
      try {
        await sendWhatsAppText({ to: phone, body: message });
        await ReminderLog.create({ payment: payment._id, contract: contract._id, customer: customer._id, channel: 'whatsapp', stage: stageIdx, message, success: true });
        results.push({ channel: 'whatsapp', success: true });
      } catch (e) {
        await ReminderLog.create({ payment: payment._id, contract: contract._id, customer: customer._id, channel: 'whatsapp', stage: stageIdx, message, success: false, error: e.message });
        results.push({ channel: 'whatsapp', success: false, error: e.message });
      }
    }

    if (config.emailEnabled && emailConfigured() && ['both', 'email'].includes(stage.channel) && email) {
      try {
        await sendEmail({ to: email, subject: 'PurpleBox Storage — Payment Reminder', text: message });
        await ReminderLog.create({ payment: payment._id, contract: contract._id, customer: customer._id, channel: 'email', stage: stageIdx, message, success: true });
        results.push({ channel: 'email', success: true });
      } catch (e) {
        await ReminderLog.create({ payment: payment._id, contract: contract._id, customer: customer._id, channel: 'email', stage: stageIdx, message, success: false, error: e.message });
        results.push({ channel: 'email', success: false, error: e.message });
      }
    }

    if (results.length === 0) return res.status(400).json({ error: 'No channel available (check phone/email and config toggles)' });
    res.json({ ok: true, stageName: stage.name, message, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reminder-config/run  — trigger full batch now
router.post('/run', async (_req, res) => {
  try {
    const result = await runPaymentReminders();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
