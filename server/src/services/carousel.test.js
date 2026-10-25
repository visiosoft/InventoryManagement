import test from 'node:test';
import assert from 'node:assert/strict';
import { bookIsReply, tapFrom, bookReply } from './carousel.js';
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

test('each card\'s Book now answers with its own unit section', () => {
    const urls = CAROUSEL_CARDS.map((c) => bookReply(c).split('Book it here: ')[1]);
    assert.deepEqual(urls, ['xs', 'ss', 'm35', 's50', 'm75', 'l', 'xl', 'xxl'].map((k) => `https://purplebox.ae/unit-details.html#unit-${k}`));
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


test('every card starts with its size', () => {
    for (const c of CAROUSEL_CARDS) assert.match(c.text, /^\*\d+ sq ft /, c.label);
    assert.deepEqual(CAROUSEL_CARDS.map((c) => c.size), [10, 25, 35, 50, 75, 100, 150, 200]);
});

test('"Book now" is a reply button (no link box on the card) answered with the booking link', () => {
    const tpl = carouselTemplate(CAROUSEL_CARDS.slice(0, 2), ['h', 'h']);
    assert.deepEqual(tpl.components[1].cards[0].components[2].buttons.map((b) => b.type), ['QUICK_REPLY', 'QUICK_REPLY']);
    assert.equal(bookIsReply(tpl.components), true);
    const send = carouselSendComponents(cardsInTemplate(tpl.components), (c) => c, { bookReply: true });
    assert.deepEqual(send[0].cards[0].components.slice(1).map((b) => [b.index, b.parameters[0].payload]), [['0', 'pb_book:F2-048'], ['1', 'pb_card:F2-048']]);
    assert.deepEqual(tapFrom({ button: { payload: 'pb_book:F2-048' } }).action, 'book');
    assert.equal(bookReply(CAROUSEL_CARDS[0]), 'Great choice! Here is the 10 sq ft unit — AED 264 / 4 weeks · 20% off till Nov 15th.\nBook it here: https://purplebox.ae/unit-details.html#unit-xs');
});

test('the first carousel (link button, old card text) still sends as before', () => {
    const old = [{ type: 'CAROUSEL', cards: [CAROUSEL_CARDS[4], CAROUSEL_CARDS[7]].map((c) => ({ components: [{ type: 'BODY', text: c.oldText }, { type: 'BUTTONS', buttons: [{ type: 'URL' }, { type: 'QUICK_REPLY' }] }] })) }];
    assert.deepEqual(cardsInTemplate(old).map((c) => c.code), ['F2-106', 'F1U014']);
    assert.equal(bookIsReply(old), false);
    assert.equal(carouselSendComponents(cardsInTemplate(old), (c) => c)[0].cards[0].components.length, 2);
});
