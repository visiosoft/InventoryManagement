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

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// A bare URL in an admin-written template (like the one-click renew/move-out
// links) turned into a clickable, on-brand link — the alternative is a
// customer copy-pasting a long link out of plain text.
// word-break/overflow-wrap so a long renewal link wraps onto a new line
// instead of extending the whole email past its column — the exact link
// this template sends is long enough on its own to trigger this.
const LINK_STYLE = 'color:#5B2BC9;font-weight:600;word-break:break-all;overflow-wrap:anywhere;';

function linkify(escapedText) {
  return escapedText.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="${LINK_STYLE}">${url}</a>`,
  );
}

function paragraphsHtml(bodyText) {
  const blocks = String(bodyText || '').trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      const html = linkify(escapeHtml(block)).replace(/\n/g, '<br>');
      return `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#4A4357;word-break:break-word;overflow-wrap:anywhere;">${html}</p>`;
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
                <td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.9;color:#4A4357;">
                  <strong style="color:#14081F;">Office:</strong> <a href="tel:+97143293924" style="color:#5B2BC9;">04 329 3924</a><br>
                  <strong style="color:#14081F;">WhatsApp:</strong> <a href="https://wa.me/971542249946" style="color:#5B2BC9;">+971 54 224 9946</a><br>
                  <strong style="color:#14081F;">Address:</strong> Warehouse 12, ABA Avenue, Al Quoz 2, Dubai
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#4A4357;">
            Thank you for storing with PurpleBox.
            <br><br>
            PurpleBox Storage Team
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;background:#F6F0E4;border-top:1px solid rgba(20,8,31,0.10);font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#756E80;">
            PurpleBox Storage, Warehouse 12, ABA Avenue, Al Quoz 2, Dubai, UAE
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`;
}
