import axios from 'axios';

// Zoho Sign integration. If credentials are not configured, runs in MOCK mode:
// sending "succeeds" instantly with a fake request id, and a simulate endpoint
// lets you test the signed-webhook flow without a Zoho account.

export function zohoConfigured() {
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN
  );
}

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry - 60_000) return cachedToken;
  const { data } = await axios.post(
    `${process.env.ZOHO_ACCOUNTS_BASE}/oauth/v2/token`,
    null,
    {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token',
      },
    }
  );
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

// Sends a signature request for a contract. `pdfBuffer` is the rendered
// contract document; `signer` is { name, email }.
export async function sendForSignature({ contract, pdfBuffer, signer }) {
  if (!zohoConfigured()) {
    return {
      mock: true,
      requestId: `MOCK-${contract.contractNo}-${Date.now()}`,
    };
  }

  const token = await getAccessToken();
  const form = new FormData();
  form.append(
    'file',
    new Blob([pdfBuffer], { type: 'application/pdf' }),
    `${contract.contractNo}.pdf`
  );
  form.append(
    'data',
    JSON.stringify({
      requests: {
        request_name: `Rental Contract ${contract.contractNo}`,
        actions: [
          {
            action_type: 'SIGN',
            recipient_name: signer.name,
            recipient_email: signer.email,
            signing_order: 1,
            verify_recipient: false,
          },
        ],
        expiration_days: 15,
        notes: 'Please review and sign your box unit rental contract.',
      },
    })
  );

  const { data: created } = await axios.post(
    `${process.env.ZOHO_API_BASE}/requests`,
    form,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );
  const requestId = created.requests.request_id;

  // Submit the request so the signer receives the email.
  const actionsPayload = {
    requests: {
      actions: created.requests.actions.map((a) => ({
        action_id: a.action_id,
        action_type: a.action_type,
        recipient_name: a.recipient_name,
        recipient_email: a.recipient_email,
        signing_order: a.signing_order,
        verify_recipient: false,
      })),
    },
  };
  const submitForm = new FormData();
  submitForm.append('data', JSON.stringify(actionsPayload));
  await axios.post(
    `${process.env.ZOHO_API_BASE}/requests/${requestId}/submit`,
    submitForm,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );

  return { mock: false, requestId };
}

export async function downloadSignedPdf(requestId) {
  if (!zohoConfigured()) return null;
  const token = await getAccessToken();
  const { data } = await axios.get(
    `${process.env.ZOHO_API_BASE}/requests/${requestId}/pdf`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, responseType: 'arraybuffer' }
  );
  return Buffer.from(data);
}
