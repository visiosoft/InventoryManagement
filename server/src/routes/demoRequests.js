/**
 * "Book a demo" from the 2Capacity marketing site (2capacity.com).
 *
 * No login, by design: the person filling it in is a prospect. The request is
 * saved first and the team is emailed second, so a mail outage loses an email,
 * never a lead. Before this the form opened the visitor's own mail app, and
 * anyone without one set up was simply lost.
 *
 * Always stored in the deployment owner's database (the same one single mode
 * serves), whatever tenancy mode is running: these are prospects for the
 * platform itself, not any one customer's business.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { DemoRequest } from '../models/index.js';
import { connectionFor } from '../tenancy/connections.js';
import { runInTenant } from '../tenancy/context.js';
import { legacyDbName, legacyOrg } from '../middleware/tenant.js';
import { sendMail } from '../services/mail.js';

const router = Router();

const FACILITY_CHOICES = ['1', '2 to 5', '6 to 20', '21 to 50', '51 or more'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A real visitor sends one of these; a script spamming the inbox sends dozens
const demoLimiter = rateLimit({
    windowMs: 10 * 60_000, max: 5, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a few minutes, or email hello@2capacity.com.' },
    skip: () => process.env.NODE_ENV === 'test',
});

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/** Cleans the posted body into the fields we keep, or explains what is missing.
 *  Pulled out so it is testable without a database. */
export function parseDemoRequest(body = {}) {
    const fields = {
        name: clip(body.name, 120),
        email: clip(body.email, 200).toLowerCase(),
        phone: clip(body.phone, 40),
        company: clip(body.company, 160),
        facilities: clip(body.facilities, 20),
        country: clip(body.country, 80),
        message: clip(body.message, 3000),
    };
    if (!fields.name || !EMAIL_RE.test(fields.email) || !fields.company || !fields.country
        || !FACILITY_CHOICES.includes(fields.facilities)) {
        return { error: 'Please add your name, a valid business email, your company name, number of facilities and country.' };
    }
    const s = body.source || {};
    fields.source = {
        page: clip(s.page, 300),
        referrer: clip(s.referrer, 300),
        utmSource: clip(s.utmSource, 120),
        utmMedium: clip(s.utmMedium, 120),
        utmCampaign: clip(s.utmCampaign, 160),
        utmTerm: clip(s.utmTerm, 160),
        gclid: clip(s.gclid, 200),
    };
    return { fields };
}

export function demoRequestEmailText(f) {
    const src = f.source || {};
    const tracking = [
        src.utmSource && `Source: ${src.utmSource}`,
        src.utmMedium && `Medium: ${src.utmMedium}`,
        src.utmCampaign && `Campaign: ${src.utmCampaign}`,
        src.utmTerm && `Keyword: ${src.utmTerm}`,
        src.gclid && 'From a Google Ads click (gclid present)',
        src.referrer && `Referrer: ${src.referrer}`,
    ].filter(Boolean);
    return [
        `Name: ${f.name}`,
        `Email: ${f.email}`,
        f.phone && `Phone / WhatsApp: ${f.phone}`,
        `Company: ${f.company}`,
        `Facilities: ${f.facilities}`,
        `Country: ${f.country}`,
        f.message && `\nWhat they want to improve or automate:\n${f.message}`,
        tracking.length && `\n${tracking.join('\n')}`,
        '\nReply to this email to answer them directly.',
    ].filter(Boolean).join('\n');
}

router.post('/', demoLimiter, (req, res) => {
    const body = req.body || {};
    // Honeypot: people never see the "website" field, bots fill it. Answer as
    // if it worked so the bot has nothing to learn from.
    if (body.website) return res.status(201).json({ ok: true });

    const { fields, error } = parseDemoRequest(body);
    if (error) return res.status(400).json({ error });

    const owner = { connection: connectionFor(legacyDbName()), org: legacyOrg() };
    return runInTenant(owner, async () => {
        let saved;
        try {
            saved = await DemoRequest.create(fields);
        } catch (e) {
            console.error('[DemoRequest] could not save:', e.message);
            return res.status(500).json({ error: 'Something went wrong. Please email hello@2capacity.com and we will set up your demo.' });
        }

        // The visitor is answered as soon as the request is safe; the email is ours to chase
        res.status(201).json({ ok: true, id: String(saved._id) });

        const to = process.env.DEMO_REQUEST_NOTIFY || 'hello@2capacity.com';
        try {
            await sendMail({
                to,
                subject: `Demo request: ${fields.company} (${fields.country})`,
                text: demoRequestEmailText(fields),
                context: { kind: 'demo_request', label: fields.company },
            });
            await DemoRequest.updateOne({ _id: saved._id }, { $set: { notified: true } });
        } catch (e) {
            console.error('[DemoRequest] saved but could not email:', e.message);
            await DemoRequest.updateOne({ _id: saved._id }, { $set: { notifyError: String(e.message).slice(0, 300) } }).catch(() => {});
        }
        return undefined;
    });
});

export default router;
