# WhatsAppLead

Separate project for pulling WhatsApp Web chats into your existing InventoryManagementSystem MongoDB.

## What this project does

- Scrapes WhatsApp Web conversations using Puppeteer.
- Opens chats one-by-one from the WhatsApp chat list (`#pane-side`, `list-item-*`).
- Upserts contacts into the existing `Lead` collection (`source: "whatsapp"`).
- Stores labels in existing `WhatsAppLabelState` collection.
- Stores messages in existing `WhatsAppMessage` collection.
- Shows a HubSpot-style contacts page with:
  - lead profile,
  - labels,
  - last 5 chat messages,
  - link to open WhatsApp Web for full history.
- Auto-sync is disabled by default; run manual sync first.

## Important notes

- This is an automation/scraping flow against WhatsApp Web UI selectors, which can change.
- On first sync, scan QR in browser if required.
- For full old history, use WhatsApp Web/Desktop directly.

## Setup

1. Copy env file:

```bash
cp .env.example .env
```

2. Set `DEFAULT_LEAD_OWNER_EMAIL` to an existing user email in your current DB.
3. `WHATSAPP_SYNC_INTERVAL_MS` is `0` by default (auto-sync disabled). Set `60000` to run every minute.
4. `WHATSAPP_ALLOW_SYNTHETIC_PHONE=true` allows saving contacts that have no visible number in WhatsApp list (uses deterministic synthetic key in `phoneNormalized`).
5. Slow interaction tuning (recommended for stable scraping):
  - `WHATSAPP_ROW_BEFORE_CLICK_MS` (default `450`)
  - `WHATSAPP_ROW_AFTER_CLICK_MS` (default `900`)
  - `WHATSAPP_BETWEEN_ROWS_MS` (default `800`)
  - `WHATSAPP_CONTACT_PANEL_SETTLE_MS` (default `600`)
6. `WHATSAPP_SKIP_GROUP_CHATS=true` skips group conversations and only syncs direct chats.
7. `WHATSAPP_ALLOWED_LABELS` can restrict saved labels to an allowlist. Example: `Inquiry,New customer`.
8. `WHATSAPP_SYNC_ONLY_ALLOWED_LABELS=true` syncs only chats that match the allowlist; set `false` to sync all chats.

5. Install dependencies:

```bash
npm install
```

6. Start server:

```bash
npm run dev
```

7. Open:

- http://localhost:5075

## API endpoints

- `GET /api/health`
- `GET /api/contacts`
- `GET /api/contacts/:leadId/messages?limit=50`
- `POST /api/sync`

If `WHATSAPP_LEAD_API_KEY` is set, include header `x-api-key` in `POST /api/sync`.

## Data mapping

### Lead creation defaults

When a phone is not present in lead table:

- `status: "new"`
- `source: "whatsapp"`
- `storageSizeValue: 0`
- `durationValue: 1`
- `durationUnit: "month"`
- `unitsNeeded: 1`

### Labels to status mapping (best effort)

- contains `won` -> `won`
- contains `lost` -> `lost`
- contains `proposal` -> `proposal_sent`
- contains `qualif` -> `qualified`
- contains `contacted` or `follow up` -> `contacted`
- otherwise if label exists -> `new`

## Folder structure

```text
whatsapplead/
  public/
    app.js
    index.html
    styles.css
  src/
    server.js
    services/
      leadSync.js
      whatsappScraper.js
  .env.example
  package.json
```
