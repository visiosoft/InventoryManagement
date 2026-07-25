import { Lead } from '../../../server/src/models/index.js';

const mongoose = Lead.base;

const configSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'whatsapplead' },
    allowedLabels: { type: [String], default: [] },
    syncOnlyAllowedLabels: { type: Boolean, default: false },
    maxChats: { type: Number, default: 15 },
    messagesPerChat: { type: Number, default: 10 },
    maxStoreMessages: { type: Number, default: 10 },
    syncIntervalMs: { type: Number, default: 0 },
    defaultOwnerEmail: { type: String, default: '' },
}, { timestamps: true });

const Config = mongoose.models.WhatsAppLeadConfig || mongoose.model('WhatsAppLeadConfig', configSchema);

export async function getConfig() {
    let cfg = await Config.findOne({ key: 'whatsapplead' });
    if (!cfg) {
        cfg = await Config.create({
            key: 'whatsapplead',
            allowedLabels: parseComma(process.env.WHATSAPP_ALLOWED_LABELS),
            syncOnlyAllowedLabels: process.env.WHATSAPP_SYNC_ONLY_ALLOWED_LABELS === 'true',
            maxChats: Number(process.env.WHATSAPP_MAX_CHATS) || 15,
            messagesPerChat: Number(process.env.WHATSAPP_MESSAGES_PER_CHAT) || 10,
            maxStoreMessages: Number(process.env.WHATSAPP_MAX_STORE_MESSAGES) || 10,
            syncIntervalMs: Number(process.env.WHATSAPP_SYNC_INTERVAL_MS) || 0,
            defaultOwnerEmail: process.env.DEFAULT_LEAD_OWNER_EMAIL || '',
        });
    }
    return cfg;
}

export async function updateConfig(updates) {
    const cfg = await getConfig();
    Object.assign(cfg, updates);
    await cfg.save();
    return cfg;
}

function parseComma(val) {
    if (!val) return [];
    return String(val).split(',').map(s => s.trim()).filter(Boolean);
}
