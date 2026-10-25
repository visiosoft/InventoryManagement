import test from 'node:test';
import assert from 'node:assert/strict';
import { CAROUSEL_CARDS, carouselTemplate, cardsInTemplate, carouselSendComponents, cardFromTap, readyCards } from './carousel.js';

test('only cards with a photo go into the template', () => {
    const have = new Set(['F2-048', 'F1U0', 'F2-069']);
    assert.deepEqual(readyCards(CAROUSEL_CARDS, (c) => have.has(c)).map((c) => c.code), ['F2-048', 'F1U0', 'F2-069']);
});

test('the template Meta approves maps back to our cards, in its order, for the send', () => {
    const cards = CAROUSEL_CARDS.slice(0, 3);
    const tpl = carouselTemplate(cards, ['h1', 'h2', 'h3']);
    assert.equal(tpl.components[1].cards.length, 3);
    assert.equal(tpl.components[1].cards[0].components[0].example.header_handle[0], 'h1');
    const back = cardsInTemplate(tpl.components);
    assert.deepEqual(back.map((c) => c.code), ['F2-048', 'F1U0', 'F2-016']);
    const send = carouselSendComponents(back, (code) => `https://x/${code}.jpg`);
    assert.equal(send[0].cards[1].components[0].parameters[0].image.link, 'https://x/F1U0.jpg');
    assert.equal(send[0].cards[1].components[1].parameters[0].payload, 'pb_card:F1U0');
    assert.equal(cardsInTemplate([{ type: 'BODY', text: 'x' }]), null);
});

test('a "Get a quote" tap says which card it came from', () => {
    assert.equal(cardFromTap({ button: { payload: 'pb_card:F1U0', text: 'Get a quote' } }).size, 25);
    assert.equal(cardFromTap({ button: { payload: 'something_else' } }), null);
});

import { toSquareJpeg } from './carousel.js';

test('a website WebP photo becomes a square JPEG, like the other cards', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const wide = createCanvas(800, 600);
    wide.getContext('2d').fillRect(0, 0, 800, 600);
    const webp = await wide.encode('webp');
    const jpeg = await toSquareJpeg(webp);
    assert.equal(jpeg[0], 0xff); assert.equal(jpeg[1], 0xd8); // JPEG magic
    const { loadImage } = await import('@napi-rs/canvas');
    const back = await loadImage(jpeg);
    assert.equal(back.width, 1080); assert.equal(back.height, 1080);
});





test('every card starts with its size', () => {
    for (const c of CAROUSEL_CARDS) assert.match(c.text, /^\*\d+ sq ft /, c.label);
    assert.deepEqual(CAROUSEL_CARDS.map((c) => c.size), [10, 25, 35, 50, 75, 100, 150, 200]);
});

test('the first carousel (old card text) still maps to its cards', () => {
    const old = [{ type: 'CAROUSEL', cards: [CAROUSEL_CARDS[4], CAROUSEL_CARDS[7]].map((c) => ({ components: [{ type: 'BODY', text: c.oldText }] })) }];
    assert.deepEqual(cardsInTemplate(old).map((c) => c.code), ['F2-106', 'F1U014']);
});

import { cardBody, priceLine, CAROUSEL_BODY, CAROUSEL_NAME } from './carousel.js';

// The live price list as of 25 Oct 2026 (websitePricing.js rows).
const PRICING = new Map([
    [10, { price: 330, offerPrice: 264, discountPct: 20, hasDiscount: true }],
    [25, { price: 625, offerPrice: 625, discountPct: 0, hasDiscount: false }],
    [35, { price: 770, offerPrice: 731.5, discountPct: 5, hasDiscount: true }],
    [50, { price: 975, offerPrice: 828.75, discountPct: 15, hasDiscount: true }],
    [75, { price: 1400, offerPrice: 1330, discountPct: 5, hasDiscount: true }],
    [100, { price: 1600, offerPrice: 1600, discountPct: 0, hasDiscount: false, hasPriceRange: true }],
    [150, { price: 2700, offerPrice: 2700, discountPct: 0, hasDiscount: false }],
    [200, { price: 3100, offerPrice: 3100, discountPct: 0, hasDiscount: false }],
]);

test('each card leads with its price, the discount and when it ends — within Meta\'s 160 characters', () => {
    assert.equal(priceLine(PRICING.get(10)), '~AED 330~ *AED 264* / 4 weeks · 20% off till Nov 15th');
    assert.equal(priceLine(PRICING.get(50)), '~AED 975~ *AED 829* / 4 weeks · 15% off till Nov 15th');
    assert.equal(priceLine(PRICING.get(25)), '*AED 625* / 4 weeks');
    assert.equal(priceLine(PRICING.get(100)), 'From *AED 1,600* / 4 weeks');
    assert.equal(cardBody(CAROUSEL_CARDS[0], new Map()), CAROUSEL_CARDS[0].text, 'no price, just the text');
    for (const c of CAROUSEL_CARDS) assert.ok(cardBody(c, PRICING).length <= 160, `${c.label}: ${cardBody(c, PRICING).length} characters`);
    assert.match(CAROUSEL_BODY, /Ending on Nov 15th\. Moving Services Available\.$/);
    assert.equal(CAROUSEL_NAME, 'purplebox_units_offer_20261115');
    const tpl = carouselTemplate(CAROUSEL_CARDS.slice(0, 1), ['h'], PRICING);
    assert.equal(tpl.components[1].cards[0].components[1].text, `~AED 330~ *AED 264* / 4 weeks · 20% off till Nov 15th\n${CAROUSEL_CARDS[0].text}`);
    assert.deepEqual(cardsInTemplate(tpl.components).map((c) => c.code), ['F2-048']);
});

test('the carousel approved before prices were added still maps to its cards', () => {
    const old = [{ type: 'CAROUSEL', cards: CAROUSEL_CARDS.slice(0, 2).map((c) => ({ components: [{ type: 'BODY', text: c.text }] })) }];
    assert.deepEqual(cardsInTemplate(old).map((c) => c.code), ['F2-048', 'F1U0']);
});

test('each card\'s Book now opens the reservation form for its size', () => {
    const tpl = carouselTemplate(CAROUSEL_CARDS, CAROUSEL_CARDS.map(() => 'h'));
    const urls = tpl.components[1].cards.map((card) => new URL(card.components[2].buttons[0].url));
    assert.ok(urls.every((u) => u.origin + u.pathname === 'https://purplebox.ae/reserve-step-1.html'));
    assert.deepEqual(urls.map((u) => [u.searchParams.get('unitLabel'), u.searchParams.get('unitSize'), u.searchParams.get('monthlyRent')]), [
        ['XS', '10 sq ft (XS)', '330'], ['S', '25 sq ft (S)', '625'], ['M', '35 sq ft (M)', '770'], ['L', '50 sq ft (L)', '975'],
        ['XL', '75 sq ft (XL)', '1400'], ['XXL', '100 sq ft (XXL)', '1600'], ['3XL', '150 sq ft (3XL)', '2700'], ['4XL', '200 sq ft (4XL)', '3100'],
    ]);
});
