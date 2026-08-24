/**
 * POST /api/whatsapp/flow — the data endpoint for the Client Information flow.
 *
 * Meta calls this itself, so there is no JWT. Authentication is the encryption:
 * only a caller holding the AES key we could decrypt with our private key can
 * produce a readable body.
 *
 * The reply is a bare base64 string, not JSON. Returning JSON here is the
 * commonest way to get "something went wrong" on the customer's phone with a
 * 200 in our logs.
 */

import { Router } from 'express';
import { Customer, Lead } from '../models/index.js';
import {
  flowKeysConfigured, decryptRequest, encryptResponse,
  readClientInfo, buildSummaryText, phoneFromFlowToken,
} from '../services/whatsappFlow.js';

const router = Router();

const suffix = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
};

/**
 * Save what the form sent.
 *
 * Matched to an existing customer on the number the flow was sent to — the
 * same last-nine-digits rule the rest of the app uses — so a tenant filling
 * this in updates their record rather than creating a second one. A flow we
 * cannot attribute still saves, because losing the submission would be worse
 * than an unlinked record somebody can merge.
 */
async function saveClientInfo({ fields, photos, phone }) {
  const { fullName, authorizedPerson, emergencyContact } = fields;

  let customer = null;
  if (phone) {
    const key = suffix(phone);
    const all = await Customer.find({}).select('fullName phone phones emergencyNumber accessPersons').lean();
    const hit = all.find((c) => [...(c.phones || []), c.phone].some((p) => suffix(p) === key));
    if (hit) customer = await Customer.findById(hit._id);
  }

  if (!customer) {
    customer = new Customer({
      fullName,
      phone: phone ? `+${String(phone).replace(/\D/g, '')}` : '',
      phones: phone ? [`+${String(phone).replace(/\D/g, '')}`] : [],
    });
  }

  // A name they typed themselves beats a placeholder we generated, but does
  // not overwrite a name somebody already corrected by hand.
  if (!customer.fullName || /^whatsapp\s*contact/i.test(customer.fullName)) customer.fullName = fullName;
  customer.emergencyNumber = emergencyContact;

  if (authorizedPerson) {
    const already = (customer.accessPersons || []).some(
      (p) => p.name?.trim().toLowerCase() === authorizedPerson.toLowerCase(),
    );
    if (!already) {
      customer.accessPersons = [...(customer.accessPersons || []), { name: authorizedPerson, relation: 'Authorized access' }];
    }
  }

  // Photos arrive as media descriptors, not image bytes — Meta uploads them to
  // its own CDN and the payload names them. What that descriptor contains is
  // logged rather than guessed at, so the download can be wired against a real
  // one instead of an assumed shape.
  const note = photos.length
    ? `ID document submitted over WhatsApp on ${new Date().toISOString().slice(0, 10)} (${photos.length} file${photos.length === 1 ? '' : 's'}).`
    : '';
  if (note) customer.notes = [customer.notes, note].filter(Boolean).join('\n');

  await customer.save();

  if (phone) {
    // Keep the lead's name in step, so the inbox stops showing a placeholder.
    await Lead.updateOne(
      { phoneNormalized: String(phone).replace(/\D/g, '') },
      { $set: { fullName } },
    ).catch(() => {});
  }

  return customer;
}

router.post('/', async (req, res) => {
  if (!flowKeysConfigured()) {
    console.error('[Flow] WHATSAPP_FLOW_PRIVATE_KEY is not set');
    return res.status(500).send('Flow endpoint is not configured');
  }

  let decrypted;
  try {
    decrypted = decryptRequest(req.body || {});
  } catch (e) {
    // 421 tells Meta the key is wrong and to start a fresh session. Anything
    // else and it retries against the same broken key.
    console.error('[Flow] could not decrypt:', e.message);
    return res.status(421).send('Could not decrypt the request');
  }

  const { body, aesKey, iv } = decrypted;
  const reply = (payload) => res.type('text/plain').send(encryptResponse(payload, aesKey, iv));

  try {
    const { action, screen, data = {}, flow_token: flowTok } = body;

    // Meta's health check, sent before the flow is published and periodically
    // after. It must be answered or the flow is marked unhealthy.
    if (action === 'ping') return reply({ data: { status: 'active' } });

    // The client reporting its own error. Acknowledging is all that is wanted.
    if (data?.error) {
      console.error('[Flow] client error:', data.error_message || data.error);
      return reply({ data: { acknowledged: true } });
    }

    if (action === 'INIT') {
      return reply({ screen: 'CLIENT_INFO', data: {} });
    }

    if (action === 'BACK') {
      return reply({ screen: 'CLIENT_INFO', data: {} });
    }

    if (action === 'data_exchange' && screen === 'CLIENT_INFO') {
      const { fields, photos, problems, ok } = readClientInfo(data);

      if (!ok) {
        // Sent back onto the same screen: a flow that accepts a blank name and
        // fails silently afterwards is worse than one that says what is wrong.
        return reply({
          screen: 'CLIENT_INFO',
          data: { error_message: `Please provide ${problems.join(' and ')}.` },
        });
      }

      const phone = phoneFromFlowToken(flowTok);
      if (!phone) console.warn('[Flow] unrecognised flow_token — saving unlinked');
      if (photos.length) console.log('[Flow] photo descriptor:', JSON.stringify(photos[0]).slice(0, 400));

      const customer = await saveClientInfo({ fields, photos, phone });
      console.log(`[Flow] saved customer ${customer._id} (${customer.fullName})${phone ? '' : ' — unlinked'}`);

      return reply({
        screen: 'SUMMARY',
        data: {
          full_name: fields.fullName,
          authorized_person: fields.authorizedPerson,
          emergency_contact: fields.emergencyContact,
          summary: buildSummaryText(fields, photos.length),
        },
      });
    }

    console.warn(`[Flow] unhandled action=${action} screen=${screen}`);
    return reply({ screen: 'CLIENT_INFO', data: { error_message: 'Sorry, something went wrong. Please try again.' } });
  } catch (e) {
    console.error('[Flow] handler failed:', e.message);
    // Encrypted, because an unencrypted body is unreadable to the client and
    // shows as a generic failure with no clue what happened.
    return reply({ screen: 'CLIENT_INFO', data: { error_message: 'We could not save that. Please try again.' } });
  }
});

export default router;
