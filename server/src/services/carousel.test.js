import test from 'node:test';
import assert from 'node:assert/strict';
import { cardLinkPage } from './carousel.js';
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

test('each card\'s Book now opens its own page, titled with its size, which goes on to its unit section', () => {
    const tpl = carouselTemplate(CAROUSEL_CARDS, CAROUSEL_CARDS.map(() => 'h'));
    const urls = tpl.components[1].cards.map((card) => card.components[2].buttons[0].url);
    assert.deepEqual(urls, ['xs', 'ss', 'm35', 's50', 'm75', 'l', 'xl', 'xxl'].map((k) => `https://api.purplebox.ae/api/public/unit/${k}`));
    const page = cardLinkPage(CAROUSEL_CARDS[0]);
    assert.match(page, /<meta property="og:title" content="10 sq ft storage unit">/);
    assert.match(page, /og:description" content="AED 264 \/ 4 weeks · 20% off till Nov 15th"/);
    assert.match(page, /url=https:\/\/purplebox\.ae\/unit-details\.html#unit-xs/);
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

test('each card leads with its price, the discount and when it ends — within Meta\'s 160 characters', () => {
    assert.equal(priceLine({ was: 330, now: 264 }), '~AED 330~ *AED 264* / 4 weeks · 20% off till Nov 15th');
    assert.equal(priceLine({ now: 625 }), '*AED 625* / 4 weeks');
    assert.equal(priceLine({ now: 1600, from: true }), 'From *AED 1,600* / 4 weeks');
    for (const c of CAROUSEL_CARDS) assert.ok(cardBody(c).length <= 160, `${c.label}: ${cardBody(c).length} characters`);
    assert.match(CAROUSEL_BODY, /Ending on Nov 15th\. Moving Services Available\.$/);
    assert.equal(CAROUSEL_NAME, 'purplebox_units_offer_20261115');
});

test('the carousel approved before prices were added still maps to its cards', () => {
    const old = [{ type: 'CAROUSEL', cards: CAROUSEL_CARDS.slice(0, 2).map((c) => ({ components: [{ type: 'BODY', text: c.text }] })) }];
    assert.deepEqual(cardsInTemplate(old).map((c) => c.code), ['F2-048', 'F1U0']);
});
