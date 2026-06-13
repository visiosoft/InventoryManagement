import 'dotenv/config';
import http from 'http';
import readline from 'readline';
import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_CONTACTS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
const PORT = Number(process.env.GOOGLE_CONTACTS_OAUTH_PORT || 53682);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Missing GOOGLE_CONTACTS_CLIENT_ID or GOOGLE_CONTACTS_CLIENT_SECRET in server/.env');
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

async function printRefreshTokenFromCode(code) {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\nAuthorization successful.');
    console.log('Put this in server/.env:');
    console.log(`GOOGLE_CONTACTS_REFRESH_TOKEN=${tokens.refresh_token || ''}`);
    if (!tokens.refresh_token) {
        console.warn('No refresh token received. Remove app consent and retry with prompt=consent.');
    }
}

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
});

console.log('Google Contacts OAuth setup');
console.log('1) Ensure this redirect URI is added in Google Cloud OAuth client:');
console.log(`   ${REDIRECT_URI}`);
console.log('2) Open this URL in your browser and approve access:');
console.log(authUrl);
console.log('3) Preferred: this script captures tokens automatically via localhost callback.');
console.log('4) Fallback: if callback does not work, copy the `code` value from redirected URL and paste it here.');

const manualCode = await ask('Paste OAuth code now (or press Enter to wait for callback): ');
if (manualCode) {
    try {
        await printRefreshTokenFromCode(manualCode);
        process.exit(0);
    } catch (e) {
        console.error('Token exchange failed:', e.message || e);
        process.exit(1);
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    if (url.pathname !== '/oauth2callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    const code = url.searchParams.get('code');
    const err = url.searchParams.get('error');

    if (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Authorization failed: ${err}`);
        console.error(`Authorization failed: ${err}`);
        server.close(() => process.exit(1));
        return;
    }

    if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing code. Return to Google consent link and complete approval.');
        console.warn('Callback hit without authorization code. Waiting for a valid callback...');
        return;
    }

    try {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Google authorization successful. You can close this tab.');

        await printRefreshTokenFromCode(code);

        server.close(() => process.exit(0));
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Token exchange failed. Check server logs.');
        console.error('Token exchange failed:', e.message || e);
        server.close(() => process.exit(1));
    }
});

server.listen(PORT, () => {
    console.log(`Waiting for OAuth callback on ${REDIRECT_URI} ...`);
});
