/**
 * The payment-due reminder.
 *
 * Uses only the values the automation engine actually supplies for a payment
 * rule: @name, @unit, @contractNo, @amount, @dueDate, @daysLeft. The template
 * this replaces referenced @invoiceNo, which the engine never provides, so it
 * would have gone out reading "Payment Reminder - @invoiceNo" in the subject
 * line. Payments are also grouped per contract rather than per invoice, so a
 * single invoice number would be the wrong thing to name anyway.
 *
 * There is no pay-now button: Stripe checkout exists only for moving invoices
 * and is not configured. Rather than link somewhere that cannot take the money,
 * the email says how to reach a person who can.
 */

export const PAYMENT_DUE_SUBJECT = 'Payment of AED @amount due on @dueDate | @contractNo';

export const PAYMENT_DUE_HTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDE3CF;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FBF8F2;border-radius:18px;overflow:hidden;">

        <tr>
          <td style="padding:28px 40px;background:#FBF8F2;border-bottom:1px solid rgba(20,8,31,0.10);">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#14081F;">
                  PurpleBox<span style="color:#5B2BC9;">.</span>
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
                  Payment due
                </td>
              </tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="padding-top:18px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:bold;color:#14081F;">
                  Your next payment of AED @amount is due on @dueDate
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#4A4357;">
            Dear @name,
            <br><br>
            This is a friendly reminder that your next storage payment is due in @daysLeft days. Everything you need is below.
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F3FF;border:1px solid #EDE5FF;border-radius:14px;">
              <tr>
                <td style="padding:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:2;color:#4A4357;">
                  <strong style="color:#14081F;">Amount:</strong> AED @amount<br>
                  <strong style="color:#14081F;">Due date:</strong> @dueDate<br>
                  <strong style="color:#14081F;">Unit:</strong> @unit<br>
                  <strong style="color:#14081F;">Contract:</strong> @contractNo
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#4A4357;">
            To pay, or if you have already sent it across, just let us know. Reply to this email, call, or message us on WhatsApp:
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
            If your payment has crossed with this email, please ignore it and accept our thanks.
            <br><br>
            PurpleBox Storage Team
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px;background:#F6F0E4;border-top:1px solid rgba(20,8,31,0.10);font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#756E80;">
            PurpleBox Storage, Warehouse 12, ABA Avenue, Al Quoz 2, Dubai, UAE<br>
            You are receiving this because you have a storage contract with PurpleBox Storage (@contractNo). This is a notice about your contract, not a marketing email.
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`;

export const PAYMENT_DUE_TEXT = [
    'Dear @name,',
    '',
    'This is a friendly reminder that your next storage payment is due in @daysLeft days.',
    '',
    'Amount: AED @amount',
    'Due date: @dueDate',
    'Unit: @unit',
    'Contract: @contractNo',
    '',
    'To pay, or if you have already sent it across, just let us know. Reply to this email, call, or message us on WhatsApp:',
    'Office: 04 329 3924',
    'WhatsApp: +971 54 224 9946',
    'Address: Warehouse 12, ABA Avenue, Al Quoz 2, Dubai',
    '',
    'If your payment has crossed with this email, please ignore it and accept our thanks.',
    '',
    'PurpleBox Storage Team',
].join('\n');

export const PAYMENT_DUE_VARIABLES = [
    '@name', '@unit', '@contractNo', '@amount', '@dueDate', '@daysLeft',
];
