import fs from 'fs';
import { google } from 'googleapis';

function hasServiceAccountConfig() {
    return Boolean(
        process.env.GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE &&
        fs.existsSync(process.env.GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE) &&
        process.env.GOOGLE_CONTACTS_DELEGATED_USER_EMAIL
    );
}

function hasOAuthConfig() {
    return Boolean(
        process.env.GOOGLE_CONTACTS_CLIENT_ID &&
        process.env.GOOGLE_CONTACTS_CLIENT_SECRET &&
        process.env.GOOGLE_CONTACTS_REFRESH_TOKEN
    );
}

export function googleContactsConfigured() {
    return hasServiceAccountConfig() || hasOAuthConfig();
}

export function googleContactsMissing() {
    const missing = [];

    if (googleContactsConfigured()) return missing;

    const serviceModeTouched = Boolean(
        process.env.GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE || process.env.GOOGLE_CONTACTS_DELEGATED_USER_EMAIL
    );
    const oauthModeTouched = Boolean(
        process.env.GOOGLE_CONTACTS_CLIENT_ID ||
        process.env.GOOGLE_CONTACTS_CLIENT_SECRET ||
        process.env.GOOGLE_CONTACTS_REFRESH_TOKEN
    );

    if (serviceModeTouched) {
        if (!process.env.GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE) missing.push('GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE');
        if (
            process.env.GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE &&
            !fs.existsSync(process.env.GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE)
        ) {
            missing.push('GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE(file_not_found)');
        }
        if (!process.env.GOOGLE_CONTACTS_DELEGATED_USER_EMAIL) missing.push('GOOGLE_CONTACTS_DELEGATED_USER_EMAIL');
        return missing;
    }

    if (oauthModeTouched) {
        if (!process.env.GOOGLE_CONTACTS_CLIENT_ID) missing.push('GOOGLE_CONTACTS_CLIENT_ID');
        if (!process.env.GOOGLE_CONTACTS_CLIENT_SECRET) missing.push('GOOGLE_CONTACTS_CLIENT_SECRET');
        if (!process.env.GOOGLE_CONTACTS_REFRESH_TOKEN) missing.push('GOOGLE_CONTACTS_REFRESH_TOKEN');
        return missing;
    }

    missing.push('GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE_or_GOOGLE_CONTACTS_CLIENT_ID');
    missing.push('GOOGLE_CONTACTS_DELEGATED_USER_EMAIL_or_GOOGLE_CONTACTS_CLIENT_SECRET');
    missing.push('GOOGLE_CONTACTS_REFRESH_TOKEN(oauth_only)');
    return missing;
}

function peopleClient() {
    let auth;

    if (hasServiceAccountConfig()) {
        auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE,
            scopes: ['https://www.googleapis.com/auth/contacts.readonly'],
            clientOptions: { subject: process.env.GOOGLE_CONTACTS_DELEGATED_USER_EMAIL },
        });
    } else {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CONTACTS_CLIENT_ID,
            process.env.GOOGLE_CONTACTS_CLIENT_SECRET
        );
        oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_CONTACTS_REFRESH_TOKEN });
        auth = oauth2Client;
    }

    return google.people({ version: 'v1', auth });
}

export async function fetchGoogleContacts({ pageSize = 500 } = {}) {
    if (!googleContactsConfigured()) {
        return { contacts: [], note: 'Google Contacts not configured' };
    }

    const people = peopleClient();
    let pageToken = undefined;
    const contacts = [];

    do {
        const { data } = await people.people.connections.list({
            resourceName: 'people/me',
            personFields: 'names,emailAddresses,phoneNumbers,organizations,biographies',
            pageSize,
            pageToken,
            sortOrder: 'LAST_MODIFIED_DESCENDING',
        });

        for (const c of data.connections || []) {
            const name = c.names?.[0]?.displayName || '';
            const email = c.emailAddresses?.[0]?.value || '';
            const phone = c.phoneNumbers?.[0]?.value || '';
            const company = c.organizations?.[0]?.name || '';
            const notes = c.biographies?.[0]?.value || '';
            if (!phone) continue;
            contacts.push({ name, email, phone, company, notes });
        }

        pageToken = data.nextPageToken || undefined;
    } while (pageToken);

    return { contacts };
}
