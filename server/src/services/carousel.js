/**
 * The unit-sizes carousel: one WhatsApp message with a card per unit size,
 * each with its photo, a "Book now" link and a "Get a quote" reply.
 *
 * Photos live with the server (server/assets/carousel/<unit code>.jpg) and
 * are served at /api/public/carousel/… — Meta needs a public link for every
 * card's photo each time the carousel is sent, and an uploaded sample of each
 * when the template is first submitted. A card whose photo is not there yet
 * is left out until it is.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CAROUSEL_DIR = path.resolve(__dirname, '../../assets/carousel');
export const CAROUSEL_NAME = 'purplebox_unit_sizes_carousel';
export const CAROUSEL_BODY = 'Need more space? PurpleBox has clean, climate-controlled storage units in Al Quoz, Dubai. Pick the size that fits you and book in minutes.';
const BOOK_URL = 'https://purplebox.ae/';

/* The cards, in order. `size` is written onto the lead when they tap
   "Get a quote" on a card with a plain sq ft size. */
export const CAROUSEL_CARDS = [
    { code: 'F2-048', size: 10, label: '10 sq ft unit', text: '*10 sq ft unit* - Suitcases, boxes and seasonal items. Perfect for a few personal things.' },
    { code: 'F1U0', size: 25, label: '25 sq ft unit', text: '*25 sq ft unit* - Extra household boxes, luggage and bedding, with room to spare.' },
    { code: 'F2-016', size: 35, label: '35 sq ft unit', source: 'https://purplebox.ae/wp-content/themes/purplebox-static-theme/images/card-unit-35-v2.webp', text: '*35 sq ft unit* - A mattress, bike, shelving and boxes. Great for a studio or while renovating.' },
    { code: 'F2-001', size: 50, label: '50 sq ft unit', source: 'https://purplebox.ae/wp-content/themes/purplebox-static-theme/images/card-unit-50-v2.webp', text: '*50 sq ft unit* - Fits a sofa plus stacks of boxes. Ideal when moving between homes.' },
    { code: 'F2-106', size: null, label: '1-bed apartment unit', source: 'https://purplebox.ae/wp-content/themes/purplebox-static-theme/images/card-unit-75-v2.webp', text: '*1-bed apartment unit* - A mattress, fridge, bike, luggage and boxes from a 1-bed apartment.' },
    { code: 'F2-069', size: null, label: 'Family storage unit', text: '*Family storage unit* - Dining set, artwork, sports gear and boxes, all safe and organised.' },
    { code: 'F1U005', size: null, label: '2-bed home unit', text: '*2-bed home unit* - Shelving, appliances, furniture and boxes from a 2-bed home.' },
    { code: 'F1U014', size: null, label: 'Whole home or business unit', text: '*Whole home or business unit* - Your entire home or business stock. Furniture, shelving, office setup and more.' },
];

export const cardImagePath = (code) => path.join(CAROUSEL_DIR, `${code}.jpg`);
export const cardHasImage = (code) => fs.existsSync(cardImagePath(code));
export const cardImageUrl = (code) => `${(process.env.API_PUBLIC_URL || 'https://api.purplebox.ae').replace(/\/+$/, '')}/api/public/carousel/${encodeURIComponent(code)}.jpg`;

/**
 * A photo as WhatsApp wants it on a carousel card: JPEG (not WebP), and
 * square like the others — every card in a carousel has to share one shape.
 * Centre-cropped to 1080×1080.
 */
export async function toSquareJpeg(buffer, size = 1080) {
    const { loadImage, createCanvas } = await import('@napi-rs/canvas');
    const img = await loadImage(buffer);
    const side = Math.min(img.width, img.height);
    const canvas = createCanvas(size, size);
    canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return canvas.encode('jpeg', 88);
}

let fetching = null;
/**
 * Cards whose photo lives on the website (a `source` link) are fetched,
 * squared and saved as JPEG the first time they are needed. Never throws:
 * a card that cannot be fetched just stays without a photo.
 */
export function ensureCardImages({ fetchImpl = fetch } = {}) {
    if (fetching) return fetching;
    fetching = (async () => {
        const out = { fetched: [], failed: [] };
        for (const c of CAROUSEL_CARDS.filter((x) => x.source && !cardHasImage(x.code))) {
            try {
                const r = await fetchImpl(c.source);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const jpeg = await toSquareJpeg(Buffer.from(await r.arrayBuffer()));
                fs.mkdirSync(CAROUSEL_DIR, { recursive: true });
                fs.writeFileSync(cardImagePath(c.code), jpeg);
                out.fetched.push(c.code);
            } catch (e) {
                out.failed.push({ code: c.code, error: e.message });
                console.error(`[Carousel] ${c.code} photo from ${c.source}:`, e.message);
            }
        }
        return out;
    })().finally(() => { fetching = null; });
    return fetching;
}

/** The cards that have a photo — the ones that go into the template. */
export const readyCards = (cards = CAROUSEL_CARDS, has = cardHasImage) => cards.filter((c) => has(c.code));

/** The template as submitted to Meta, given one uploaded sample handle per card. */
export function carouselTemplate(cards, handles) {
    return {
        name: CAROUSEL_NAME,
        language: 'en',
        category: 'MARKETING',
        components: [
            { type: 'BODY', text: CAROUSEL_BODY },
            {
                type: 'CAROUSEL',
                cards: cards.map((c, i) => ({
                    components: [
                        { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handles[i]] } },
                        { type: 'BODY', text: c.text },
                        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Book now', url: BOOK_URL }, { type: 'QUICK_REPLY', text: 'Get a quote' }] },
                    ],
                })),
            },
        ],
    };
}

/**
 * Which of our cards an approved carousel template holds, in its order —
 * matched on each card's text, so the photos sent always belong to the card
 * the customer sees. Null when it is not a carousel we know.
 */
export function cardsInTemplate(metaComponents = []) {
    const carousel = (metaComponents || []).find((c) => String(c.type).toUpperCase() === 'CAROUSEL');
    if (!carousel) return null;
    const out = [];
    for (const card of carousel.cards || []) {
        const body = (card.components || []).find((c) => String(c.type).toUpperCase() === 'BODY');
        const match = CAROUSEL_CARDS.find((c) => c.text === String(body?.text || '').trim());
        if (!match) return null;
        out.push(match);
    }
    return out.length ? out : null;
}

/** The send-time components: each card's photo, and a payload on "Get a quote" saying which card. */
export function carouselSendComponents(cards, imageUrl = cardImageUrl) {
    return [{
        type: 'carousel',
        cards: cards.map((c, i) => ({
            card_index: i,
            components: [
                { type: 'header', parameters: [{ type: 'image', image: { link: imageUrl(c.code) } }] },
                { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `pb_card:${c.code}` }] },
            ],
        })),
    }];
}

/** The card a "Get a quote" tap came from, or null. */
export function cardFromTap(raw) {
    const m = String(raw?.button?.payload || '').match(/^pb_card:(.+)$/);
    return m ? CAROUSEL_CARDS.find((c) => c.code === m[1]) || null : null;
}

/**
 * A customer tapped "Get a quote" on a card: the lead records which unit
 * they want — the size when it is a plain sq ft one and none is set yet —
 * so whoever replies starts from it.
 */
export async function handleCarouselTap({ phoneNormalized, raw }) {
    const card = cardFromTap(raw);
    if (!card) return { handled: false };
    const { Lead } = await import('../models/index.js');
    const lead = await Lead.findOne({ phoneNormalized });
    if (lead) {
        if (card.size && !(lead.storageSizeValue > 0)) lead.storageSizeValue = card.size;
        if (!lead.spaceNeeded) lead.spaceNeeded = card.label;
        lead.timeline.push({ type: 'note', text: `Tapped "Get a quote" on the ${card.label} card (unit sizes carousel)` });
        await lead.save().catch((e) => console.error('[Carousel] lead save:', e.message));
    }
    return { handled: true, card };
}
