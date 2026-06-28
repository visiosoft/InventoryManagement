import { sendWhatsAppText, whatsappSendConfigured } from './whatsapp.js';

function formatDate(d) {
  if (!d) return 'TBD';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export async function notifyJobConfirmed(job, customer) {
  if (!whatsappSendConfigured() || !customer?.phone) return null;
  const msg = [
    `Hi ${customer.fullName},`,
    `Your moving job *${job.jobNo}* has been confirmed!`,
    '',
    `📅 Date: ${formatDate(job.scheduledDate)}`,
    job.scheduledTimeSlot ? `🕐 Time: ${job.scheduledTimeSlot}` : '',
    `📍 From: ${job.pickupAddress || 'TBD'}`,
    `📍 To: ${job.deliveryAddress || 'TBD'}`,
    '',
    'We will notify you when our crew is on the way. Thank you for choosing PurpleBox Moving!',
  ].filter(Boolean).join('\n');
  try { return await sendWhatsAppText({ to: customer.phone, body: msg }); } catch { return null; }
}

export async function notifyCrewOnTheWay(job, customer) {
  if (!whatsappSendConfigured() || !customer?.phone) return null;
  const msg = [
    `Hi ${customer.fullName},`,
    `Our crew is on the way for your move *${job.jobNo}*! 🚛`,
    '',
    `📍 Pickup: ${job.pickupAddress || 'your location'}`,
    job.scheduledTimeSlot ? `🕐 Expected: ${job.scheduledTimeSlot}` : '',
    '',
    'Please make sure someone is available at the pickup address. See you shortly!',
  ].filter(Boolean).join('\n');
  try { return await sendWhatsAppText({ to: customer.phone, body: msg }); } catch { return null; }
}

export async function notifyJobCompleted(job, customer) {
  if (!whatsappSendConfigured() || !customer?.phone) return null;
  const msg = [
    `Hi ${customer.fullName},`,
    `Your move *${job.jobNo}* has been completed! ✅`,
    '',
    'We hope everything went smoothly. If you notice any issues with your belongings, please contact us within 48 hours.',
    '',
    'Thank you for choosing PurpleBox Moving! We appreciate your business. 🙏',
  ].join('\n');
  try { return await sendWhatsAppText({ to: customer.phone, body: msg }); } catch { return null; }
}

export async function notifyInvoiceReady(job, customer, invoiceUrl) {
  if (!whatsappSendConfigured() || !customer?.phone) return null;
  const msg = [
    `Hi ${customer.fullName},`,
    `The invoice for your move *${job.jobNo}* is ready.`,
    '',
    invoiceUrl ? `📄 View invoice: ${invoiceUrl}` : '',
    '',
    'If you have any questions about the charges, please don\'t hesitate to contact us.',
  ].filter(Boolean).join('\n');
  try { return await sendWhatsAppText({ to: customer.phone, body: msg }); } catch { return null; }
}

export async function notifyPaymentReceived(customer, invoiceNo, amount) {
  if (!whatsappSendConfigured() || !customer?.phone) return null;
  const msg = [
    `Hi ${customer.fullName},`,
    `We've received your payment of *AED ${amount.toLocaleString()}* for invoice *${invoiceNo}*. ✅`,
    '',
    'Thank you!',
  ].join('\n');
  try { return await sendWhatsAppText({ to: customer.phone, body: msg }); } catch { return null; }
}
