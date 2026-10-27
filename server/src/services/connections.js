/**
 * Every system the CRM is connected to, as the Bots page shows it: whether
 * it is connected, what bots can read from it, and how to connect it.
 *
 * Pure: give it each connection's state; the route asks the services.
 */

export function describeConnections(s = {}) {
   const row = (key, name, icon, connected, reads, extra = {}) => ({ key, name, icon, connected: Boolean(connected), reads, ...extra });
   const gmail = s.gmail || {};
   return [
      row('zohoBooks', 'Zoho Books', '📒', s.zohoBooks, 'Invoices, payments received, who owes what, sales by day', { connect: 'settings' }),
      row('gmail', 'Gmail', '📬', gmail.connected && gmail.canRead,
         'The contact@ inbox: who wrote, about what, and the full email when needed',
         {
            connect: 'oauth:gmail',
            account: gmail.account || '',
            note: gmail.connected && !gmail.canRead ? 'Connected for sending only — reconnect and allow reading so bots can read the inbox.' : '',
            partly: Boolean(gmail.connected && !gmail.canRead),
         }),
      row('whatsapp', 'WhatsApp', '💬', s.whatsapp, 'Every chat: who is waiting, what customers asked, which ad they came from', { connect: 'settings' }),
      row('stripe', 'Stripe', '💳', s.stripe, 'Card payments taken, amounts, who paid and for which invoice', { connect: 'settings' }),
      row('analytics', 'Google Analytics', '📈', s.analytics, 'Website visits by day and country, most read pages', { connect: 'oauth:analytics' }),
      row('drive', 'Google Drive', '🗂️', s.drive, 'Customer documents and receipts filed there, by name', { connect: 'oauth:drive' }),
      row('metaAds', 'Meta Ads', '📣', s.metaAds, 'What each ad cost, for cost per chat and per customer', { connect: 'settings' }),
      row('twilio', 'SMS (Twilio)', '✉️', s.twilio, 'Sending texts when you confirm one', { connect: 'settings' }),
      row('web', 'Web search', '🌐', s.claude, 'Competitor prices and offers, news, any public page', { connect: 'settings', note: s.claude ? '' : 'Needs the Claude key in Settings → Integrations.' }),
   ];
}
