import { Payment, ReminderConfig, ReminderLog } from '../models/index.js';
import { sendWhatsAppText } from './whatsapp.js';
import { sendEmail, emailConfigured } from './emailService.js';

const DEFAULT_STAGES = [
  {
    name: 'Friendly Reminder',
    daysBeforeDue: 15,
    frequencyDays: 5,
    channel: 'both',
    message:
      'Dear {{name}}, this is a friendly reminder that your storage payment of AED {{amount}} for Unit {{unit}} is due on {{dueDate}}. Please arrange payment at your earliest convenience. Thank you, PurpleBox Storage.',
  },
  {
    name: 'Payment Reminder',
    daysBeforeDue: 7,
    frequencyDays: 3,
    channel: 'both',
    message:
      'Dear {{name}}, your storage payment of AED {{amount}} for Unit {{unit}} is due in {{daysLeft}} day(s) on {{dueDate}}. Please ensure payment is made on time to avoid any service interruption. Thank you, PurpleBox Storage.',
  },
  {
    name: 'Urgent Reminder',
    daysBeforeDue: 3,
    frequencyDays: 1,
    channel: 'both',
    message:
      'URGENT: Dear {{name}}, your payment of AED {{amount}} for Unit {{unit}} is due in {{daysLeft}} day(s) on {{dueDate}}. Immediate action is required to avoid access restrictions. Please contact us now. PurpleBox Storage.',
  },
  {
    name: 'Overdue Notice',
    daysBeforeDue: 0,
    frequencyDays: 1,
    channel: 'both',
    message:
      'OVERDUE NOTICE: Dear {{name}}, your payment of AED {{amount}} for Unit {{unit}} was due on {{dueDate}} and is now overdue. Your access to the unit may be restricted. Please make payment immediately or contact us. PurpleBox Storage.',
  },
  {
    name: 'Final Vacate Notice',
    daysBeforeDue: -7,
    frequencyDays: 1,
    channel: 'both',
    message:
      'FINAL NOTICE: Dear {{name}}, your account for Unit {{unit}} is severely overdue (AED {{amount}} due {{dueDate}}). This is your final notice. Please vacate the unit within 7 days or make full payment immediately. Failure to comply may result in legal action. PurpleBox Storage.',
  },
];

async function loadConfig() {
  let config = await ReminderConfig.findOne();
  if (!config) {
    config = await ReminderConfig.create({ stages: DEFAULT_STAGES });
  }
  return config;
}

function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function selectStage(stages, daysLeft) {
  const applicable = stages.filter((s) => s.daysBeforeDue >= daysLeft);
  if (applicable.length === 0) return null;
  applicable.sort((a, b) => a.daysBeforeDue - b.daysBeforeDue);
  return { stage: applicable[0], idx: stages.indexOf(applicable[0]) };
}

async function wasRecentlySent(paymentId, stageIdx, channel, frequencyDays) {
  const cutoff = new Date(Date.now() - frequencyDays * 24 * 60 * 60 * 1000);
  const existing = await ReminderLog.findOne({
    payment: paymentId,
    stage: stageIdx,
    channel,
    success: true,
    sentAt: { $gte: cutoff },
  });
  return !!existing;
}

async function sendAndLog({ payment, contractId, customerId, channel, stageIdx, message, phone, email }) {
  let success = false;
  let error = '';
  try {
    if (channel === 'whatsapp') {
      await sendWhatsAppText({ to: phone, body: message });
    } else {
      await sendEmail({ to: email, subject: 'PurpleBox Storage — Payment Reminder', text: message });
    }
    success = true;
  } catch (e) {
    error = e.message || String(e);
  }
  await ReminderLog.create({
    payment: payment._id,
    contract: contractId,
    customer: customerId,
    channel,
    stage: stageIdx,
    message,
    success,
    error,
  });
  return success;
}

export async function runPaymentReminders() {
  const config = await loadConfig();
  if (!config.enabled) return { sent: 0, skipped: 0, errors: 0 };

  const now = new Date();
  const windowMs = 20 * 24 * 60 * 60 * 1000;

  const payments = await Payment.find({
    status: { $ne: 'paid' },
    dueDate: { $lte: new Date(now.getTime() + windowMs) },
  }).populate({
    path: 'contract',
    match: { status: 'active' },
    populate: [
      { path: 'customer' },
      { path: 'unit' },
      { path: 'units' },
    ],
  });

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const payment of payments) {
    if (!payment.contract) continue;

    const contract = payment.contract;
    const customer = contract.customer;
    if (!customer) continue;

    const unit = contract.units?.length > 1
      ? contract.units.map((u) => u.unitNumber).join(', ')
      : (contract.unit?.unitNumber ?? '—');

    const daysLeft = Math.ceil((new Date(payment.dueDate).getTime() - now.getTime()) / 86400000);
    const result = selectStage(config.stages, daysLeft);
    if (!result) { skipped++; continue; }

    const { stage, idx: stageIdx } = result;

    const vars = {
      name: customer.fullName,
      amount: Number(payment.amount).toFixed(2),
      unit,
      dueDate: new Date(payment.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      daysLeft: String(Math.max(0, daysLeft)),
    };
    const message = interpolate(stage.message, vars);

    const phone = (customer.phones?.[0] || customer.phone || '').replace(/\s+/g, '');
    const email = customer.email || '';

    const wantsWhatsApp = config.whatsappEnabled && ['both', 'whatsapp'].includes(stage.channel) && phone;
    const wantsEmail = config.emailEnabled && emailConfigured() && ['both', 'email'].includes(stage.channel) && email;

    if (!wantsWhatsApp && !wantsEmail) { skipped++; continue; }

    let anySent = false;

    if (wantsWhatsApp) {
      const already = await wasRecentlySent(payment._id, stageIdx, 'whatsapp', stage.frequencyDays);
      if (!already) {
        const ok = await sendAndLog({ payment, contractId: contract._id, customerId: customer._id, channel: 'whatsapp', stageIdx, message, phone });
        if (ok) { sent++; anySent = true; } else errors++;
      } else { skipped++; }
    }

    if (wantsEmail) {
      const already = await wasRecentlySent(payment._id, stageIdx, 'email', stage.frequencyDays);
      if (!already) {
        const ok = await sendAndLog({ payment, contractId: contract._id, customerId: customer._id, channel: 'email', stageIdx, message, email });
        if (ok) { sent++; anySent = true; } else errors++;
      } else { skipped++; }
    }

    if (!anySent && !wantsWhatsApp && !wantsEmail) skipped++;
  }

  console.log(`[Reminders] sent=${sent} skipped=${skipped} errors=${errors}`);
  return { sent, skipped, errors };
}
