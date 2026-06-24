import 'dotenv/config';
import { connectDb } from '../../server/src/db.js';
import { Lead, WhatsAppLabelState, WhatsAppMessage } from '../../server/src/models/index.js';

async function run() {
    await connectDb();

    const leads = await Lead.find({ source: 'whatsapp' }).select('_id phoneNormalized').lean();
    const leadIds = leads.map((item) => item._id);
    const phoneKeys = leads
        .map((item) => String(item.phoneNormalized || '').trim())
        .filter(Boolean);

    const [leadResult, labelResult, messageResult] = await Promise.all([
        Lead.deleteMany({ source: 'whatsapp' }),
        WhatsAppLabelState.deleteMany({ phoneNormalized: { $in: phoneKeys } }),
        WhatsAppMessage.deleteMany({
            $or: [
                { lead: { $in: leadIds } },
                { phoneNormalized: { $in: phoneKeys } },
            ],
        }),
    ]);

    console.log('[WhatsAppLead][Clear] Completed cleanup.');
    console.log(`[WhatsAppLead][Clear] Leads deleted: ${leadResult.deletedCount || 0}`);
    console.log(`[WhatsAppLead][Clear] Label states deleted: ${labelResult.deletedCount || 0}`);
    console.log(`[WhatsAppLead][Clear] Messages deleted: ${messageResult.deletedCount || 0}`);
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[WhatsAppLead][Clear] Failed:', error?.message || error);
        process.exit(1);
    });
