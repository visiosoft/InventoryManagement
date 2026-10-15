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
  readClientInfo, buildSummaryText, phoneFromFlowToken, publicKeyPem, flowKeyDiagnostics,
} from '../services/whatsappFlow.js';
import { readExitSurveyData, saveExitSurvey } from '../services/exitSurvey.js';

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
  } else {
    // No usable token, so there is no number to match on. Fall back to the
    // name and emergency contact together: a retried submission — Meta resends
    // on a timeout — would otherwise create a second customer every time.
    customer = await Customer.findOne({
      fullName: new RegExp(`^${fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      emergencyNumber: emergencyContact,
    });
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

/**
 * GET /api/whatsapp/flow/public-key — the key to paste into Meta's Flows →
 * Endpoint → "Sign public key" step. Same key for every flow on the number.
 */
router.get('/public-key', (_req, res) => {
  if (!flowKeysConfigured()) return res.status(500).type('text/plain').send('WHATSAPP_FLOW_PRIVATE_KEY is not set');
  try {
    res.type('text/plain').send(publicKeyPem());
  } catch (e) {
    res.status(500).type('text/plain').send(e.message);
  }
});

/**
 * POST /api/whatsapp/flow/exit-survey — the endpoint for the EXIT_SURVEY flow.
 *
 * Its own URL, so a request needs no guessing about which flow it belongs to
 * (the payload does not say). Same key and encryption as the Client Info flow.
 *
 * With the form's footer on "complete", Meta only calls this for its health
 * check and opening the flow; the answers arrive on the webhook. If the footer
 * is switched to "data_exchange", the answers come here instead, are saved,
 * and the flow is closed with the SUCCESS response.
 */
// GET /api/whatsapp/flow/exit-survey — a status check for a person opening
// the URL in a browser. Meta itself only ever POSTs here.
router.get('/exit-survey', (_req, res) => {
  let key = 'not set';
  if (flowKeysConfigured()) {
    try { publicKeyPem(); key = 'ok'; } catch (e) { key = e.message; }
  }
  res.json({
    endpoint: 'WhatsApp Flow endpoint for EXIT_SURVEY',
    note: 'Meta calls this with POST. Opening it in a browser only shows this status.',
    privateKey: key,
    ready: key === 'ok',
    keyDetails: flowKeyDiagnostics(),
  });
});

router.post('/exit-survey', async (req, res) => {
  if (!flowKeysConfigured()) {
    console.error('[ExitSurveyFlow] WHATSAPP_FLOW_PRIVATE_KEY is not set');
    return res.status(500).send('Flow endpoint is not configured');
  }

  let decrypted;
  try {
    decrypted = decryptRequest(req.body || {});
  } catch (e) {
    console.error('[ExitSurveyFlow] could not decrypt:', e.message);
    return res.status(421).send('Could not decrypt the request');
  }

  const { body, aesKey, iv } = decrypted;
  const reply = (payload) => res.type('text/plain').send(encryptResponse(payload, aesKey, iv));

  try {
    const { action, data = {}, flow_token: token } = body;

    if (action === 'ping') return reply({ data: { status: 'active' } });

    if (data?.error) {
      console.error('[ExitSurveyFlow] client error:', data.error_message || data.error);
      return reply({ data: { acknowledged: true } });
    }

    if (action === 'INIT' || action === 'BACK') return reply({ screen: 'EXIT_SURVEY', data: {} });

    if (action === 'data_exchange') {
      const answers = readExitSurveyData({ ...data, flow_token: token });
      if (!answers.reason || !answers.rating || !answers.comeBack) {
        return reply({ screen: 'EXIT_SURVEY', data: { error_message: 'Please answer the reason, rating and come-back questions.' } });
      }
      await saveExitSurvey({ answers });
      return reply({
        screen: 'SUCCESS',
        data: { extension_message_response: { params: { flow_token: token, reason: answers.reason, rating: String(answers.rating), come_back: answers.comeBack } } },
      });
    }

    console.warn(`[ExitSurveyFlow] unhandled action=${action}`);
    return reply({ screen: 'EXIT_SURVEY', data: {} });
  } catch (e) {
    console.error('[ExitSurveyFlow] handler failed:', e.message);
    return reply({ screen: 'EXIT_SURVEY', data: { error_message: 'We could not save that. Please try again.' } });
  }
});

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
