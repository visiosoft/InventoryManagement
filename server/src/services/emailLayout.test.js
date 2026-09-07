import test from 'node:test';
import assert from 'node:assert/strict';
import { brandedEmailHtml } from './emailLayout.js';

test('carries the logo header and the standard footer', () => {
    const html = brandedEmailHtml({ bodyText: 'Dear Zulfiqar,\n\nYour unit is ready.' });
    assert.match(html, /logo-1\.png/);
    assert.match(html, /Thank you for storing with PurpleBox/);
    assert.match(html, /04 329 3924/);
});

test('a blank line starts a new paragraph, a single line break stays inline', () => {
    const html = brandedEmailHtml({ bodyText: 'Line one.\n\nSee you soon.\nThanks.' });
    // Two blank-line-separated blocks become two <p> tags.
    assert.equal((html.match(/<p /g) || []).length, 2);
    // Within one block, a single newline becomes a <br>, not a new paragraph.
    assert.match(html, /See you soon\.<br>Thanks\./);
});

test('a bare link in the body becomes clickable, in the brand colour', () => {
    const html = brandedEmailHtml({ bodyText: 'Renew here: https://office.purplebox.ae/renew/abc' });
    assert.match(html, /<a href="https:\/\/office\.purplebox\.ae\/renew\/abc" style="color:#5B2BC9[^"]*">/);
});

test('the renew/move-out links become real buttons, not raw URLs', () => {
    const html = brandedEmailHtml({
        bodyText: 'Option 1: Renew. Keep your unit.\nhttps://office.purplebox.ae/api/contracts/public/renewal/abc/tok?intent=renewing'
            + '\n\nOption 2: Vacate. Return the key.\nhttps://office.purplebox.ae/api/contracts/public/renewal/abc/tok?intent=not_renewing',
    });
    assert.match(html, /<a href="[^"]*intent=renewing"[^>]*background:#5B2BC9[^>]*>Renew my unit<\/a>/);
    assert.match(html, /<a href="[^"]*intent=not_renewing"[^>]*>Schedule move-out<\/a>/);
    // The raw URL text itself never appears — only the button label does.
    assert.doesNotMatch(html, />https:\/\/office\.purplebox\.ae\/api\/contracts/);
});

test('an "Option N:" opening reads as a heading, the rest of the sentence stays plain', () => {
    const html = brandedEmailHtml({ bodyText: 'Option 1: Renew. Keep your unit and continue storing with us.' });
    assert.match(html, /<strong style="color:#2D1259;">Option 1: Renew\.<\/strong> Keep your unit/);
});

test('a "<" typed into template text cannot inject markup into the email', () => {
    const html = brandedEmailHtml({ bodyText: 'Rate < 5% guaranteed, see <script>alert(1)</script>' });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
});
