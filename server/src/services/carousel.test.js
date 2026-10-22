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
