import { Router } from 'express';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WhatsAppMessage } from '../models/index.js';

const router = Router();
const GRAPH = 'https://graph.facebook.com/v20.0';

// Meta's media URLs expire within minutes, so fetched bytes are cached on
// disk. The media id is immutable, which makes it a safe cache key.
const CACHE_DIR = path.join(process.cwd(), 'uploads', 'whatsapp-media');

/** Pull the media descriptor out of a stored webhook message. */
export function mediaFromRaw(raw) {
    if (!raw || typeof raw !== 'object') return null;
    for (const kind of ['image', 'video', 'audio', 'voice', 'document', 'sticker']) {
        const node = raw[kind];
        if (node?.id) {
            return {
                kind,
                id: String(node.id),
                mimeType: node.mime_type || '',
                filename: node.filename || '',
                caption: node.caption || '',
            };
        }
    }
    return null;
}

/**
 * Stream one inbound attachment.
 *
 * Two hops are required: the id resolves to a short-lived signed URL, and
 * that URL still needs the bearer token to download. Neither can be handed
 * to the browser — the first expires, the second would leak the token — so
 * the server fetches and re-serves the bytes.
 */
router.get('/:messageId', async (req, res) => {
    try {
        const msg = await WhatsAppMessage.findOne({ messageId: req.params.messageId }).select('raw type').lean();
        if (!msg) return res.status(404).json({ error: 'Message not found' });

        const media = mediaFromRaw(msg.raw);
        if (!media) return res.status(404).json({ error: 'This message has no attachment' });

        const token = process.env.WHATSAPP_ACCESS_TOKEN;
        if (!token) return res.status(501).json({ error: 'WhatsApp is not configured' });

        const safeId = createHash('sha256').update(media.id).digest('hex').slice(0, 40);
        const cachePath = path.join(CACHE_DIR, safeId);
        const metaPath = `${cachePath}.json`;

        if (existsSync(cachePath) && existsSync(metaPath)) {
            const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
            res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
            res.setHeader('Cache-Control', 'private, max-age=86400');
            if (meta.filename) res.setHeader('Content-Disposition', `inline; filename="${meta.filename}"`);
            return res.send(readFileSync(cachePath));
        }

        const lookup = await fetch(`${GRAPH}/${media.id}`, { headers: { Authorization: `Bearer ${token}` } });
        const info = await lookup.json().catch(() => ({}));
        if (!lookup.ok || !info?.url) {
            return res.status(502).json({ error: info?.error?.message || 'Could not resolve the attachment' });
        }

        const file = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } });
        if (!file.ok) return res.status(502).json({ error: `Download failed (HTTP ${file.status})` });
        const buf = Buffer.from(await file.arrayBuffer());

        const mimeType = info.mime_type || media.mimeType || 'application/octet-stream';
        try {
            mkdirSync(CACHE_DIR, { recursive: true });
            writeFileSync(cachePath, buf);
            writeFileSync(metaPath, JSON.stringify({ mimeType, filename: media.filename }));
        } catch { /* caching is an optimisation, not a requirement */ }

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'private, max-age=86400');
        if (media.filename) res.setHeader('Content-Disposition', `inline; filename="${media.filename}"`);
        res.send(buf);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
