import mongoose from 'mongoose';
import { ClientInfoSubmission, Customer, Document } from '../models/index.js';

/* How ready a customer's file is for a booking, and what the WhatsApp ID form
 * did — summarised for lists (Book Unit) without a request per row. */

const ID_DOC_TYPES = ['emirates_id', 'passport', 'id_proof'];

/** The checklist a booking needs. Authorized person is optional, so not counted. */
export function profileCompleteness(c = {}, { hasIdDocument = false } = {}) {
    const checks = [
        ['name', Boolean(c.fullName && !/^whatsapp\s*contact/i.test(c.fullName))],
        ['phone', Boolean(c.phone || c.phones?.length)],
        ['email', Boolean(c.email)],
        ['nationality', Boolean(c.nationality)],
        ['emergency contact', Boolean(c.emergencyNumber)],
        ['ID number', Boolean(c.emiratesId || c.passportNumber)],
        ['ID expiry', Boolean(c.eidExpiry || c.passportExpiry)],
        ['ID document', hasIdDocument],
    ];
    const done = checks.filter(([, ok]) => ok).length;
    return {
        pct: Math.round((done / checks.length) * 100),
        done,
        total: checks.length,
        missing: checks.filter(([, ok]) => !ok).map(([label]) => label),
    };
}

/** { [customerId]: { profile, whatsappId } } for a set of customers, in three queries. */
export async function profileStatusFor(customerIds) {
    const ids = [...new Set(customerIds.filter(Boolean).map(String))].filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return {};
    const oids = ids.map((id) => new mongoose.Types.ObjectId(id));
    const [customers, docCounts, submissions] = await Promise.all([
        Customer.find({ _id: { $in: ids } })
            .select('fullName phone phones email nationality emergencyNumber emiratesId eidExpiry passportNumber passportExpiry')
            .lean(),
        Document.aggregate([
            { $match: { customer: { $in: oids }, type: { $in: ID_DOC_TYPES } } },
            { $group: { _id: '$customer', n: { $sum: 1 } } },
        ]),
        ClientInfoSubmission.aggregate([
            { $match: { customer: { $in: oids } } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: '$customer', latest: { $first: '$$ROOT' } } },
        ]),
    ]);
    const docs = Object.fromEntries(docCounts.map((d) => [String(d._id), d.n]));
    const subs = Object.fromEntries(submissions.map((s) => [String(s._id), s.latest]));
    const out = {};
    for (const c of customers) {
        const id = String(c._id);
        const s = subs[id];
        out[id] = {
            profile: profileCompleteness(c, { hasIdDocument: (docs[id] || 0) > 0 }),
            idDocuments: docs[id] || 0,
            whatsappId: s ? {
                status: s.status, at: s.createdAt, idType: s.idType,
                filesSaved: s.filesSaved, filesTotal: s.filesTotal,
                problem: s.problems?.[0] || '', resolved: Boolean(s.resolvedAt),
            } : null,
        };
    }
    return out;
}
