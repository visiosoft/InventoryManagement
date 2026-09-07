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
    const html = brandedEmailHtml({ bodyText: 'Line one.\n\nOption 1: Renew.\nOption 2: Vacate.' });
    // Two blank-line-separated blocks become two <p> tags.
    assert.equal((html.match(/<p /g) || []).length, 2);
    // Within one block, a single newline becomes a <br>, not a new paragraph.
    assert.match(html, /Option 1: Renew\.<br>Option 2: Vacate\./);
});

test('a bare link in the body becomes clickable, in the brand colour', () => {
    const html = brandedEmailHtml({ bodyText: 'Renew here: https://office.purplebox.ae/renew/abc' });
    assert.match(html, /<a href="https:\/\/office\.purplebox\.ae\/renew\/abc" style="color:#5B2BC9[^"]*">/);
});

test('a "<" typed into template text cannot inject markup into the email', () => {
    const html = brandedEmailHtml({ bodyText: 'Rate < 5% guaranteed, see <script>alert(1)</script>' });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
});
