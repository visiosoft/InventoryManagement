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
/* The current offer, as on the website's unit details page. Each card shows
   its price (struck-out old price when discounted) above its text. A new
   offer gets its own template name, so the old one stays sendable while the
   new one is with Meta. */
export const PROMO = { endsOn: '2026-11-15', label: 'Nov 15th' };
export const CAROUSEL_NAME = `purplebox_units_offer_${PROMO.endsOn.replace(/-/g, '')}`;
export const CAROUSEL_BODY = `Looking for Air Conditioned & Clean Storage Space in Al Quoz Dubai with 24/7 Access? Please Check Out our Units Below and Take Advantage of Latest Discounts Ending on ${PROMO.label}. Moving Services Available.`;
// "Book now" on a card opens that unit's section of the unit details page;
// a card without its own section opens the page itself.
const BOOK_URL = 'https://purplebox.ae/unit-details.html';

/* The cards, in order. `size` is written onto the lead when they tap
   "Get a quote". `oldText` is a card's text in an earlier approved
   template, so that one still sends with the right photos. */
export const CAROUSEL_CARDS = [
    { code: 'F2-048', was: 330, now: 264, bookUrl: 'https://purplebox.ae/unit-details.html#unit-xs', size: 10, label: '10 sq ft unit', text: '*10 sq ft unit* - Suitcases, boxes and seasonal items. Perfect for a few personal things.' },
    { code: 'F1U0', now: 625, bookUrl: 'https://purplebox.ae/unit-details.html#unit-ss', size: 25, label: '25 sq ft unit', text: '*25 sq ft unit* - Extra household boxes, luggage and bedding, with room to spare.' },
    { code: 'F2-016', was: 770, now: 732, bookUrl: 'https://purplebox.ae/unit-details.html#unit-m35', size: 35, label: '35 sq ft unit', source: 'https://purplebox.ae/wp-content/themes/purplebox-static-theme/images/card-unit-35-v2.webp', text: '*35 sq ft unit* - A mattress, bike, shelving and boxes. Great for a studio or while renovating.' },
    { code: 'F2-001', was: 975, now: 829, bookUrl: 'https://purplebox.ae/unit-details.html#unit-s50', size: 50, label: '50 sq ft unit', source: 'https://purplebox.ae/wp-content/themes/purplebox-static-theme/images/card-unit-50-v2.webp', text: '*50 sq ft unit* - Fits a sofa plus stacks of boxes. Ideal when moving between homes.' },
    { code: 'F2-106', was: 1400, now: 1330, bookUrl: 'https://purplebox.ae/unit-details.html#unit-m75', size: 75, label: '75 sq ft 1-bed apartment unit', source: 'https://purplebox.ae/wp-content/themes/purplebox-static-theme/images/card-unit-75-v2.webp', oldText: '*1-bed apartment unit* - A mattress, fridge, bike, luggage and boxes from a 1-bed apartment.', text: '*75 sq ft 1-bed apartment unit* - A mattress, fridge, bike, luggage and boxes from a 1-bed apartment.' },
    { code: 'F2-069', now: 1600, from: true, bookUrl: 'https://purplebox.ae/unit-details.html#unit-l', size: 100, label: '100 sq ft family storage unit', oldText: '*Family storage unit* - Dining set, artwork, sports gear and boxes, all safe and organised.', text: '*100 sq ft family storage unit* - Dining set, artwork, sports gear and boxes, all safe and organised.' },
    { code: 'F1U005', now: 2700, bookUrl: 'https://purplebox.ae/unit-details.html#unit-xl', size: 150, label: '150 sq ft 2-bed home unit', oldText: '*2-bed home unit* - Shelving, appliances, furniture and boxes from a 2-bed home.', text: '*150 sq ft 2-bed home unit* - Shelving, appliances, furniture and boxes from a 2-bed home.' },
    { code: 'F1U014', now: 3100, bookUrl: 'https://purplebox.ae/unit-details.html#unit-xxl', size: 200, label: '200 sq ft whole home or business unit', oldText: '*Whole home or business unit* - Your entire home or business stock. Furniture, shelving, office setup and more.', text: '*200 sq ft whole home or business unit* - Your entire home or business stock. Furniture, shelving, office setup and more.' },
];

const aedFmt = (n) => `AED ${Number(n).toLocaleString('en-US')}`;

/** The price line on a card: "~AED 330~ *AED 264* / 4 weeks · 20% off till Nov 15th". */
export function priceLine(c, promo = PROMO) {
    if (c.was > c.now) return `~${aedFmt(c.was)}~ *${aedFmt(c.now)}* / 4 weeks · ${Math.round((1 - c.now / c.was) * 100)}% off till ${promo.label}`;
    return `${c.from ? 'From ' : ''}*${aedFmt(c.now)}* / 4 weeks`;
}

/** A card's text as it appears in the template: its price, then what fits. */
export const cardBody = (c) => `${priceLine(c)}\n${c.text}`;

/* "Book now" opens a page of ours first. WhatsApp puts a box with the
   linked page's title on each card; the website's page title is the same
   for every unit ("Unit Details | PurpleBox Storage Dubai"), so each card
   links to its own page titled with its size and price, which sends the
   customer straight on to that unit on the website. */
const apiBase = () => (process.env.API_PUBLIC_URL || 'https://api.purplebox.ae').replace(/\/+$/, '');
export const cardKey = (c) => (c.bookUrl || '').split('#unit-')[1] || c.code.toLowerCase();
export const cardLinkUrl = (c) => `${apiBase()}/api/public/unit/${cardKey(c)}`;

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** The page behind a card's "Book now": its preview reads the unit size and price. */
export function cardLinkPage(c) {
    const title = `${c.size} sq ft storage unit`;
    const desc = priceLine(c).replace(/[~*]/g, '').replace(/^AED [\d,]+ (?=AED)/, '');
    const to = c.bookUrl || BOOK_URL;
    return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="PurpleBox Storage">
${cardHasImage(c.code) ? `<meta property="og:image" content="${esc(cardImageUrl(c.code))}">` : ''}
<meta http-equiv="refresh" content="0;url=${esc(to)}">
</head><body><script>location.replace(${JSON.stringify(to)})</script><a href="${esc(to)}">${esc(title)}</a></body></html>`;
}

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
                        { type: 'BODY', text: cardBody(c) },
                        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Book now', url: cardLinkUrl(c) }, { type: 'QUICK_REPLY', text: 'Get a quote' }] },
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
        // Matched on what fits, so a template from before the prices were added still sends.
        const text = String(body?.text || '').trim();
        const match = CAROUSEL_CARDS.find((c) => [c.text, c.oldText].filter(Boolean).some((t) => text === t || text.endsWith(`\n${t}`)));
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
