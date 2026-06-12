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
npm run seed       # creates admin user, 8 unit types, 64 sample units (idempotent)
npm run dev        # API on http://localhost:5010

# 2. Frontend (new terminal)
cd client
npm install
npm run dev        # app on http://localhost:5173 (proxies /api to :5010)
```

**Default login:** `admin@purplebox.local` / `admin123` — change this after first login (or edit the seed).

Configuration lives in [server/.env](server/.env) (Mongo URI, JWT secret, integration credentials). The Vite dev server proxies `/api` and `/uploads` to the backend, so no client-side env is needed.

## Features

- **Dashboard** — occupancy %, available units, revenue this month, expiring contracts (14 days), overdue payments
- **Units** — color-coded grid by size and status (available / occupied / reserved / maintenance) + table view, CRUD
- **Customers** — searchable directory with contract history and documents
- **Contracts** — 4-step wizard (customer → unit → terms → review), automatic payment schedule generation, lifecycle: draft → pending signature → active → ended/cancelled. Unit status stays in sync automatically. Printable contract PDF.
- **Payments** — schedule per contract, record payments (cash/bank/card), automatic overdue flagging
- **Documents** — upload to Google Drive (or local storage), linked to customers and contracts; signed contracts archived automatically
- **Reports** — revenue by month, occupancy by size, availability search by size/date range, upcoming vacancies, CSV exports
- **Settings** — weekly/monthly rates per unit size, integration status
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

## Project layout

```
server/src/
  index.js          Express app, route mounting, auth middleware
  db.js             Mongo connection (with SRV-DNS fallback for restrictive networks)
  seed.js           Admin user + unit types + sample units
  models/index.js   User, UnitType, Unit, Customer, Contract, Payment, Document, AuditLog
  routes/           auth, units, unitTypes, customers, contracts, payments, documents, reports
  services/         schedule (payment generation), contractPdf, zoho, drive
client/src/
  lib/              api client, auth context, types, utils
  components/       ui primitives, Layout (sidebar shell)
  pages/            Dashboard, Units, Customers(+Detail), Contracts(+New/Detail),
                    Payments, Documents, Reports, Settings, Login
```

## Notes

- The seeded rates and unit counts are placeholders — adjust them in **Settings** (rates) or `server/src/seed.js` (counts).
- Payments past their due date are flagged overdue automatically whenever payment lists or the dashboard load.
- A unit can only have one open contract at a time; closing a contract frees the unit and removes future unpaid scheduled payments.
