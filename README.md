# PurpleBox — Box Unit Rental Management System

Inventory, contracts, payments, and reporting for a box-unit rental facility
(10 / 25 / 35 / 50 / 75 / 100 / 150 / 200 sq ft units, rented weekly or monthly).

## Stack

- **Frontend** — React 19 + TypeScript + Vite, Tailwind CSS v4, TanStack Query, Recharts (`client/`)
- **Backend** — Node.js + Express + Mongoose, JWT auth (`server/`, port **5010**)
- **Database** — MongoDB Atlas (database `PurpleBox`)
- **Integrations** — Zoho Sign (contract e-signature) and Google Drive (document storage), both with automatic mock/local fallback until credentials are configured

## Getting started

```bash
# 1. Backend
cd server
npm install
npm run seed              # creates the admin user (idempotent)
npm run import:inventory  # imports the real 155-unit inventory (replaces all units/contracts!)
npm run dev               # API on http://localhost:5010

# 2. Frontend (new terminal)
cd client
npm install
npm run dev        # app on http://localhost:5173 (proxies /api to :5010)
```

**Default login:** `admin@purplebox.local` / `admin123` — change this after first login (or edit the seed).

Configuration lives in [server/.env](server/.env) (Mongo URI, JWT secret, integration credentials). The Vite dev server proxies `/api` and `/uploads` to the backend, so no client-side env is needed.

## Netlify deployment notes

This project has a separate frontend and backend. Netlify hosts only the frontend.

1. Deploy the backend API separately (for example: Render, Railway, Fly.io, Azure App Service).
2. In Netlify site settings, add environment variable:
   - `VITE_API_BASE_URL=https://<your-backend-host>/api`
3. Redeploy the Netlify site.

Without `VITE_API_BASE_URL`, the app uses `/api` on the same host, which causes `404` on Netlify for routes like `/api/auth/login`.

## Features

- **Dashboard** — occupancy %, available units, revenue this month, expiring contracts (14 days), overdue payments
- **Units** — real facility inventory (155 units, floors F1/F2) with per-unit size, monthly price (AED), and dimensions; color-coded grid by floor and status + table view, CRUD. Weekly contract rates default to monthly ÷ 4 (the agreement defines a month as four weeks).
- **Customers** — searchable directory with contract history and documents
- **Leads** — pipeline management with status/source, lead datetime, phone/email, storage size needed, duration needed, owner, and number of units needed; quick status updates and filtering
- **Quotes** — quote number generation, quote date/expiry/salesperson/template, customer details, line items with qty/rate/discount, adjustment, totals, notes, and PDF export
- **Invoices** — customer-linked invoices with invoice/order numbers, terms/due date/salesperson/bank info, item table, customer notes, terms & conditions, status, attachments (up to 10 files, 10MB each), and PDF export
- **Vendors** — vendor directory with contact/company details, payment terms, categories, search/filter, and CSV import
- **Purchases** — vendor-linked purchase management with PO number, terms/due date, item table, totals, status tracking, and attachments (up to 10 files, 10MB each)
- **Expenses** — expense records linked to vendors with account/date/amount/reference/tax fields, status tracking, manual entry/edit, and CSV import with vendor auto-linking
- **Contracts** — 4-step wizard (customer → unit → terms → review), automatic payment schedule generation, lifecycle: draft → pending signature → active → ended/cancelled. Unit status stays in sync automatically. Printable contract PDF.
- **Payments** — schedule per contract, record payments (cash/bank/card), automatic overdue flagging
- **Documents** — upload to Google Drive (or local storage), linked to customers and contracts; signed contracts archived automatically
- **Reports** — revenue by month, occupancy by size, availability search by size/date range, upcoming vacancies, CSV exports
- **Settings** — weekly/monthly rates per unit size, integration status
- **Integrations (v1 additions)** — WhatsApp Meta webhook setup/verification and Google Contacts sync to leads (auto create/update by phone)
- Dark/light mode

## Zoho Sign setup (optional — mock mode until configured)

Without credentials, "Send for signature" simulates the flow and a **Simulate signed** button lets you test end-to-end.

1. Create a **Self Client** at <https://api-console.zoho.com> (use the console matching your data center: `.com`, `.eu`, `.in`, …).
2. Generate a grant code with scope `ZohoSign.documents.ALL,ZohoSign.account.READ`, then exchange it for a **refresh token**.
3. Fill in `server/.env`:
   ```
   ZOHO_CLIENT_ID=...
   ZOHO_CLIENT_SECRET=...
   ZOHO_REFRESH_TOKEN=...
   ZOHO_API_BASE=https://sign.zoho.com/api/v1      # match your DC, e.g. sign.zoho.eu
   ZOHO_ACCOUNTS_BASE=https://accounts.zoho.com    # match your DC
   ```
4. (Optional) In Zoho Sign → Settings → Webhooks, point the *completed* event to `https://<your-host>/api/contracts/zoho-webhook` so contracts auto-activate when signed. Without the webhook, use **Mark as signed** after the customer signs.

## Google Drive setup (optional — local storage until configured)

Without credentials, files are stored under `server/uploads/` and served at `/uploads/...`.

1. In Google Cloud Console: create a project, enable the **Google Drive API**, create a **service account**, and download its JSON key.
2. Create a Drive folder and **share it with the service account's email** (Editor).
3. Fill in `server/.env`:
   ```
   GOOGLE_SERVICE_ACCOUNT_FILE=C:\path\to\service-account.json
   GOOGLE_DRIVE_FOLDER_ID=<the folder id from its URL>
   ```

## WhatsApp setup (v1: setup verification only)

WhatsApp v1 in this project currently provides integration readiness and webhook verification endpoints.
Inbound/outbound lead messaging automation is intentionally not enabled yet.

Fill in `server/.env`:

```
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
```

Webhook URL for Meta:

```
GET/POST https://<your-host>/api/integrations/whatsapp/webhook
```

## Google Contacts setup (single shared company account)

Any number imported from Google Contacts is treated as a lead.
Sync behavior is auto create/update by normalized phone number.

Fill in `server/.env`:

```
GOOGLE_CONTACTS_SERVICE_ACCOUNT_FILE=C:\path\to\service-account.json
GOOGLE_CONTACTS_DELEGATED_USER_EMAIL=<workspace-user@yourdomain.com>
```

Use **Settings → Google Contacts → Sync now** to run a manual sync.

## Project layout

```
server/src/
  index.js          Express app, route mounting, auth middleware
  db.js             Mongo connection (with SRV-DNS fallback for restrictive networks)
  seed.js           Admin user
  importInventory.js  Replaces all units with data/inventory.json (from the inventory spreadsheet)
   models/index.js   User, Unit, Customer, Lead, Vendor, Contract, Quote,
                              Invoice, Purchase, Expense,
                              Payment, Document, AuditLog
   routes/           auth, units, unitTypes, customers, vendors, leads,
                              quotes, invoices, purchases, expenses,
                              contracts, payments, documents, reports, integrations
   services/         schedule (payment generation), contractPdf, quotePdf,
                              invoicePdf, csv, zoho, drive, whatsapp, googleContacts
client/src/
  lib/              api client, auth context, types, utils
  components/       ui primitives, Layout (sidebar shell)
   pages/            Dashboard, Units, Customers(+Detail), Vendors, Leads,
                              Quotes, Invoices, Purchases, Expenses,
                              Contracts(+New/Detail), Payments, Documents, Reports,
                              Settings, Login
```

## Expense CSV import

- UI import: **Expenses → Import CSV** (uses `/api/expenses/import/csv`)
- CLI import:

```bash
cd server
npm run import:expenses -- "C:\\path\\to\\Expense.csv"
```

Import uses `Expense Reference ID` as upsert key when present and attempts vendor linking by matching CSV `Vendor` against vendor `contactName` / `companyName` / `displayName`.

## Contract backup import

- CLI import from PurpleBox JSON backup:

```bash
cd server
npm run import:contracts -- "C:\\path\\to\\purplebox-backup-YYYY-MM-DD-HHMMSS.json"
```

- Import behavior:
   - Uses backup `contracts[].id` as upsert key (`externalId`)
   - Creates/links customers from `tenants[]`
   - Maps contract units by backup `unit_ids` -> backup `units[].unit_number` -> local `Unit.unitNumber`
   - Stores source fields such as payment method and raw payload for traceability

- Note: contracts whose unit cannot be mapped to a local unit are skipped and reported in import summary.

## Notes

- Unit prices are per unit (monthly, AED) and editable on the Units page. Inventory status was mapped from the spreadsheet notes: "done" → available, "used"/"store" → occupied (in-house use), everything else (missing ceiling/sprinkler, not installed, not built) → maintenance; the original note is kept on each unit.
- Payments past their due date are flagged overdue automatically whenever payment lists or the dashboard load.
- A unit can only have one open contract at a time; closing a contract frees the unit and removes future unpaid scheduled payments.
