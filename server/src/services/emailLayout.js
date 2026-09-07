/**
 * The one branded shell every template-driven email to a customer goes out
 * in: logo header, a plain-text body turned into paragraphs, and the
 * standard contact-details footer. Built once here rather than per template
 * so "our standard design" means one thing, not whatever HTML someone last
 * pasted into a database row — see routes/messageTemplates.js for how that
 * went wrong before.
 *
 * Takes already-interpolated plain text (line breaks and all) — never raw
 * user HTML — so a `<` typed into a template body cannot break the layout
 * or inject markup into the email.
 */

const LOGO_URL = 'https://purplebox.ae/wp-content/uploads/2026/05/logo-1.png';

// Arial/Helvetica render everywhere, but this stack picks up a real
// system sans (Segoe UI, San Francisco) wherever the mail client honours it,
// instead of settling for the plainest common denominator.
const BODY_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// word-break/overflow-wrap so a long renewal link wraps onto a new line
// instead of extending the whole email past its column — a plain link this
// long is what triggered the horizontal-scroll bug this replaced.
const LINK_STYLE = `color:#5B2BC9;font-weight:600;word-break:break-all;overflow-wrap:anywhere;font-family:${BODY_FONT};`;

function buttonHtml(url, label, { bg, fg, border }) {
  return `<a href="${url}" style="display:inline-block;margin:10px 0 6px;padding:13px 26px;border-radius:999px;font-family:${BODY_FONT};font-size:14.5px;font-weight:700;text-decoration:none;background:${bg};color:${fg};${border ? `border:1px solid ${border};` : ''}">${label}</a>`;
}

// renewLink()/moveOutLink() in services/renewalLink.js — the two one-click
// answers a contract-expiry email sends. Recognised by their own ?intent=
// query param and rendered as real buttons instead of a bare, unreadably
// long URL; anything else stays a plain inline link.
function linkify(escapedText) {
  return escapedText.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    if (/[?&](?:amp;)?intent=renewing\b/.test(url)) {
      return buttonHtml(url, 'Renew my unit', { bg: '#5B2BC9', fg: '#FFFFFF' });
    }
    if (/[?&](?:amp;)?intent=not_renewing\b/.test(url)) {
      return buttonHtml(url, 'Schedule move-out', { bg: '#FFFFFF', fg: '#14081F', border: 'rgba(20,8,31,.18)' });
    }
    return `<a href="${url}" style="${LINK_STYLE}">${url}</a>`;
  });
}

// A short leading label — "Option 1: Renew.", "Please note:" — set apart in
// weight and colour so a paragraph reads as a heading-plus-detail instead of
// one flat run of text. Only the label itself is touched, and only when it
// opens the paragraph, so this never reaches into the middle of a sentence.
function emphasiseLeadIn(text) {
  const optionLead = text.match(/^(Option\s+\d+:\s*[^.\n]*\.)/);
  if (optionLead) {
    return `<strong style="color:#2D1259;">${optionLead[1]}</strong>${text.slice(optionLead[1].length)}`;
  }
  const labelLead = text.match(/^([A-Za-z][A-Za-z ]{1,28}:)(\s)/);
  if (labelLead) {
    return `<strong style="color:#14081F;">${labelLead[1]}</strong>${labelLead[2]}${text.slice(labelLead[0].length)}`;
  }
  return text;
}

function paragraphsHtml(bodyText) {
  const blocks = String(bodyText || '').trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      const html = linkify(emphasiseLeadIn(escapeHtml(block))).replace(/\n/g, '<br>');
      return `<p style="margin:0 0 18px;font-family:${BODY_FONT};font-size:15.5px;line-height:1.7;color:#4A4357;word-break:break-word;overflow-wrap:anywhere;">${html}</p>`;
    })
    .join('');
}

/**
 * @param {{ bodyText: string }} args - Plain text with @-placeholders already
 *   filled in.
 * @returns {string} A complete, self-contained HTML email.
 */
export function brandedEmailHtml({ bodyText }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDE3CF;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:18px;overflow:hidden;">

        <tr>
          <td style="padding:28px 40px;background:#FFFFFF;border-bottom:1px solid rgba(20,8,31,0.10);">
            <img src="${LOGO_URL}" alt="PurpleBox Storage" width="201" height="65"
                 style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:201px;">
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px 8px;">
            ${paragraphsHtml(bodyText)}
          </td>
        </tr>

        <tr>
          <td style="padding:8px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F0E4;border-radius:14px;">
              <tr>
                <td style="padding:18px 20px;font-family:${BODY_FONT};font-size:13px;line-height:1.9;color:#4A4357;">
                  <strong style="color:#14081F;">Office:</strong> <a href="tel:+97143293924" style="color:#5B2BC9;">04 329 3924</a><br>
                  <strong style="color:#14081F;">WhatsApp:</strong> <a href="https://wa.me/971542249946" style="color:#5B2BC9;">+971 54 224 9946</a><br>
                  <strong style="color:#14081F;">Address:</strong> Warehouse 12, ABA Avenue, Al Quoz 2, Dubai
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px 32px;font-family:${BODY_FONT};font-size:14px;line-height:1.6;color:#4A4357;">
            Thank you for storing with PurpleBox.
            <br><br>
            PurpleBox Storage Team
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;background:#F6F0E4;border-top:1px solid rgba(20,8,31,0.10);font-family:${BODY_FONT};font-size:12px;line-height:1.6;color:#756E80;">
            PurpleBox Storage, Warehouse 12, ABA Avenue, Al Quoz 2, Dubai, UAE
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`;
}
