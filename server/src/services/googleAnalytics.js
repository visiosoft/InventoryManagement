import fs from 'fs';
import { google } from 'googleapis';

/**
 * Website traffic for the Dashboard's "Website analytics" widget — a GA4
 * property read through the Data API. Same dual-mode shape as every other
 * Google integration here (drive.js, googleContacts.js): a service-account
 * key file, or OAuth reusing whichever Google account is already connected
 * for Drive/Gmail (that account just needs Viewer access added to the GA4
 * property directly — auth and property access are separate things; being
 * able to log in as that account doesn't by itself grant it GA4 access).
 *
 * Either mode still needs GA4_PROPERTY_ID — a property, not the account.
 */

function hasServiceAccountConfig() {
    return Boolean(
        process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE &&
        fs.existsSync(process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE) &&
        process.env.GA4_PROPERTY_ID
    );
}

function hasOAuthConfig() {
    const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN;
    return Boolean(clientId && clientSecret && refreshToken && process.env.GA4_PROPERTY_ID);
}

export function analyticsConfigured() {
    return hasServiceAccountConfig() || hasOAuthConfig();
}

export function analyticsMissing() {
    if (analyticsConfigured()) return [];
    const missing = [];
    if (!process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE && !process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN) {
        missing.push('GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE_or_GOOGLE_ANALYTICS_REFRESH_TOKEN');
    }
    if (!process.env.GA4_PROPERTY_ID) missing.push('GA4_PROPERTY_ID');
    return missing;
}

function auth() {
    if (hasServiceAccountConfig()) {
        return new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE,
            scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
        });
    }
    const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN });
    return oauth2Client;
}

function client() {
    return google.analyticsdata({ version: 'v1beta', auth: auth() });
}

const propertyPath = () => `properties/${process.env.GA4_PROPERTY_ID}`;
const num = (v) => Number(v) || 0;

/**
 * Today's visits, the last N days by country, and the last N days' trend.
 * `days` covers the country breakdown and the trend line; "today" is
 * always its own separate report — "what's happening right now" is a
 * different question from "the pattern over time".
 */
export async function websiteAnalytics({ days = 30 } = {}) {
    if (!analyticsConfigured()) {
        return { configured: false, missing: analyticsMissing() };
    }

    const c = client();
    const run = (requestBody) => c.properties.runReport({ property: propertyPath(), requestBody }).then((r) => r.data);

    const [todayReport, yesterdayReport, countryReport, trendReport] = await Promise.all([
        run({ dateRanges: [{ startDate: 'today', endDate: 'today' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' }] }),
        run({ dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }], metrics: [{ name: 'sessions' }] }),
        run({
            dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
            dimensions: [{ name: 'country' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 15,
        }),
        run({
            dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
        }),
    ]);

    const todayRow = todayReport.rows?.[0]?.metricValues || [];
    const sessionsToday = num(todayRow[0]?.value);
    const usersToday = num(todayRow[1]?.value);
    const newUsersToday = num(todayRow[2]?.value);
    const sessionsYesterday = num(yesterdayReport.rows?.[0]?.metricValues?.[0]?.value);

    const byCountry = (countryReport.rows || []).map((r) => ({
        country: r.dimensionValues?.[0]?.value || 'Unknown',
        sessions: num(r.metricValues?.[0]?.value),
    }));
    const totalSessionsInRange = byCountry.reduce((s, c2) => s + c2.sessions, 0);

    // GA4's 'date' dimension comes back as YYYYMMDD with no separators.
    const trend = (trendReport.rows || []).map((r) => {
        const raw = r.dimensionValues?.[0]?.value || '';
        const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
        return { date, sessions: num(r.metricValues?.[0]?.value) };
    });

    return {
        configured: true,
        today: {
            sessions: sessionsToday, users: usersToday, newUsers: newUsersToday,
            newVisitorPct: sessionsToday ? Math.round((newUsersToday / sessionsToday) * 100) : 0,
            vsYesterdayPct: sessionsYesterday ? Math.round(((sessionsToday - sessionsYesterday) / sessionsYesterday) * 100) : null,
        },
        byCountry, totalSessionsInRange, trend, days,
    };
}
