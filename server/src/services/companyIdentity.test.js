import test from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_CO } from './companyIdentity.js';

/**
 * The merge rule, stated separately from the database.
 *
 * The guarantee that matters: a facility nobody has filled in must produce the
 * exact letterhead documents carried before facilities existed. Anything else
 * silently rewords every quotation the day this ships.
 */
const pick = (...vals) => {
    for (const v of vals) {
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
};

function letterhead(site, fallbackSite) {
    return {
        name: pick(site?.legalName, FALLBACK_CO.name),
        tagline: pick(site?.tagline, fallbackSite?.tagline, FALLBACK_CO.tagline),
        addr1: pick(site?.addr1, fallbackSite?.addr1, FALLBACK_CO.addr1),
        addr2: pick(site?.addr2, fallbackSite?.addr2, FALLBACK_CO.addr2),
        country: pick(site?.country, fallbackSite?.country, FALLBACK_CO.country),
        phone: pick(site?.phone, fallbackSite?.phone, FALLBACK_CO.phone),
        email: pick(site?.email, fallbackSite?.email, FALLBACK_CO.email),
    };
}

/** Exactly the two facilities in production today. */
const AL_QUOZ = { name: 'Al Quoz Facility', code: 'AL', address: 'ABA Avenue ' };
const ABU_DHABI = { name: 'Abu Dhabi Facility', code: '', address: '' };

test('a facility with no branding prints what documents printed before', () => {
    const co = letterhead(AL_QUOZ, AL_QUOZ);
    for (const k of ['name', 'tagline', 'addr1', 'addr2', 'country', 'phone', 'email']) {
        assert.equal(co[k], FALLBACK_CO[k], `${k} changed`);
    }
});

test('the facility name is not mistaken for the trading name', () => {
    // "Al Quoz Facility" is an internal label. Printing it as the company on a
    // customer's quotation would be wrong, and was the easy mistake here.
    const co = letterhead(AL_QUOZ, AL_QUOZ);
    assert.equal(co.name, 'PurpleBox');
    assert.notEqual(co.name, AL_QUOZ.name);
});

test('the short address on the sites list is not used as a letterhead line', () => {
    // `address` is "ABA Avenue " — a label, not the full postal address.
    const co = letterhead(AL_QUOZ, AL_QUOZ);
    assert.equal(co.addr1, 'Al Quoz 2, Warehouse 12, ABA Avenue');
    assert.notEqual(co.addr1.trim(), AL_QUOZ.address.trim());
});

test('a filled-in facility prints its own details', () => {
    const co = letterhead({
        ...ABU_DHABI, legalName: 'PurpleBox Abu Dhabi',
        addr1: 'Mussafah M-9', phone: '0097125550000', email: 'ad@purplebox.ae',
    }, AL_QUOZ);
    assert.equal(co.name, 'PurpleBox Abu Dhabi');
    assert.equal(co.addr1, 'Mussafah M-9');
    assert.equal(co.phone, '0097125550000');
    assert.equal(co.email, 'ad@purplebox.ae');
});

test('a half-filled facility takes the rest from the main one', () => {
    // Abu Dhabi's address is set but its phone is not: the phone falls through
    // rather than printing blank, which is what an empty string would do.
    const co = letterhead({ ...ABU_DHABI, addr1: 'Mussafah M-9' }, AL_QUOZ);
    assert.equal(co.addr1, 'Mussafah M-9');
    assert.equal(co.phone, FALLBACK_CO.phone);
});

test('an empty string counts as not filled in, not as a blank line', () => {
    // Abu Dhabi has address:'' and code:'' today. Treating those as deliberate
    // would print an empty letterhead block on its documents.
    const co = letterhead({ legalName: '', addr1: '   ', phone: '' }, AL_QUOZ);
    assert.equal(co.name, FALLBACK_CO.name);
    assert.equal(co.addr1, FALLBACK_CO.addr1);
    assert.equal(co.phone, FALLBACK_CO.phone);
});

test('a document with no facility at all still has a letterhead', () => {
    const co = letterhead(null, null);
    assert.equal(co.name, FALLBACK_CO.name);
    assert.equal(co.addr1, FALLBACK_CO.addr1);
    assert.ok(!Object.values(co).some((v) => v === undefined || v === null));
});
