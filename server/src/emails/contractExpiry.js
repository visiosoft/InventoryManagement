/**
 * The contract-expiry email.
 *
 * Kept as a module rather than pasted into the database by hand so the wording
 * lives in the repository, can be reviewed in a diff, and can be reinstalled
 * without anyone retyping it.
 *
 * Placeholders follow the automation engine's own `@name` convention and are
 * resolved by interpolate() in services/automationEngine.js. `@renewLink` and
 * `@moveOutLink` are the one-click answers built in services/renewalLink.js.
 */

export const CONTRACT_EXPIRY_SUBJECT = 'Your storage contract @contractNo expires on @endDate';

export const CONTRACT_EXPIRY_HTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDE3CF;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:18px;overflow:hidden;">

        <tr>
          <td style="padding:28px 40px;background:#FFFFFF;border-bottom:1px solid rgba(20,8,31,0.10);">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td>
                  <img src="https://purplebox.ae/wp-content/uploads/2026/05/logo-1.png"
                       alt="PurpleBox Storage" width="201" height="65"
                       style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:201px;">
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:40px 40px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#F7F3FF;border:1px solid #EDE5FF;border-radius:999px;padding:6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:0.08em;color:#4A1FA0;text-transform:uppercase;">
                  Contract expiring soon
                </td>
              </tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="padding-top:18px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:bold;color:#14081F;">
                  Your storage unit contract expires on @endDate
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#4A4357;">
            Dear @name,
            <br><br>
            This is a reminder that your storage contract with PurpleBox Storage for unit <strong style="color:#14081F;">@unit</strong> is due to expire in @daysLeft days, on <strong style="color:#14081F;">@endDate</strong>.
            <br><br>
            Please let us know how you would like to proceed:
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="48%" valign="top" style="background:#F7F3FF;border:1px solid #EDE5FF;border-radius:14px;padding:20px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#2D1259;">
                        Option 1: Renew
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#4A4357;">
                        Keep your unit and continue storing with us.
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="4%">&nbsp;</td>
                <td width="48%" valign="top" style="background:#F6F0E4;border:1px solid rgba(20,8,31,0.10);border-radius:14px;padding:20px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#14081F;">
                        Option 2: Vacate
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#4A4357;">
                        Clear out your unit and return the key/access device by <strong>@endDate</strong>.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#4A4357;">
            If we do not hear from you by <strong style="color:#14081F;">@endDate</strong>, a late fee of <strong style="color:#14081F;">@lateFee</strong> will apply from that date until the unit is renewed or vacated.
          </td>
        </tr>

        <tr>
          <td style="padding:28px 40px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:999px;background:#5B2BC9;" bgcolor="#5B2BC9">
                  <a href="@renewLink" style="display:block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;border-radius:999px;text-decoration:none;">
                    Renew my unit
                  </a>
                </td>
                <td style="width:12px;">&nbsp;</td>
                <td style="border-radius:999px;border:1px solid rgba(20,8,31,0.16);" bgcolor="#FFFFFF">
                  <a href="@moveOutLink" style="display:block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#14081F;border-radius:999px;text-decoration:none;">
                    Schedule move-out
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#4A4357;">
            Or reach us directly. Reply to this email, call, or message us on WhatsApp:
          </td>
        </tr>
        <tr>
          <td style="padding:14px 40px 0;">
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
          <td style="padding:28px 40px 36px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#4A4357;">
            Thank you for storing with PurpleBox.
            <br><br>
            PurpleBox Storage Team
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px;background:#F6F0E4;border-top:1px solid rgba(20,8,31,0.10);font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#756E80;">
            PurpleBox Storage, Warehouse 12, ABA Avenue, Al Quoz 2, Dubai, UAE<br>
            You are receiving this because you have an active storage contract with PurpleBox Storage (@contractNo). This is a notice about your contract, not a marketing email.
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`;

// The alternative part, for clients that will not render HTML. Not a courtesy:
// a reminder that arrives blank is a reminder nobody acts on.
export const CONTRACT_EXPIRY_TEXT = [
    'Dear @name,',
    '',
    'This is a reminder that your storage contract with PurpleBox Storage for unit @unit is due to expire in @daysLeft days, on @endDate.',
    '',
    'Please let us know how you would like to proceed:',
    '',
    'Option 1: Renew. Keep your unit and continue storing with us.',
    '@renewLink',
    '',
    'Option 2: Vacate. Clear the unit and return the key/access device by @endDate.',
    '@moveOutLink',
    '',
    'If we do not hear from you by @endDate, a late fee of @lateFee will apply from that date until the unit is renewed or vacated.',
    '',
    'Or reach us directly:',
    'Office: 04 329 3924',
    'WhatsApp: +971 54 224 9946',
    'Address: Warehouse 12, ABA Avenue, Al Quoz 2, Dubai',
    '',
    'Thank you for storing with PurpleBox.',
    'PurpleBox Storage Team',
].join('\n');

export const CONTRACT_EXPIRY_VARIABLES = [
    '@name', '@unit', '@endDate', '@daysLeft', '@rate', '@contractNo',
    '@lateFee', '@renewLink', '@moveOutLink',
];
