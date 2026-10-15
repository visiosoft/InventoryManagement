# PurpleBox stored inventory — Phase 1

The `/warehouse` screen extends the existing application. It does not replace storage-unit inventory, customers, contracts, payments or invoicing.

## Delivered scope

- Batch creation of 1–50 customer-owned containers with UUID primary keys and unique, sequential `PBX-BX`, `PBX-ITM`, `PBX-PLT` and `PBX-TOT` codes.
- Associations to existing `Customer`, optional `Contract` (the existing booking entity), optional booked `Unit`, and `Site` (facility).
- Facility/warehouse locations with optional parent hierarchy, unique `PBX-LOC` labels and direct-location container, weight and volume limits.
- Receiving-area scans, private condition photos, scan-verified putaway, and supervisor-authorized relocation with a required reason.
- Camera Code 128 / QR decoding plus keyboard-wedge USB/Bluetooth scanners. Camera requires HTTPS or localhost and browser camera permission.
- A4 and 4×6 PDF operational labels with logo, Code 128, QR and human-readable code. Labels encode only the object ID. Browser/PDF printing is user initiated; the system records a print request, not an unprovable physical print success.
- Staff search by code, customer/name/phone, booking, description/contents and location, plus item custody history.
- Mobile-sized controls, scan success/error feedback, device vibration where supported, and explicit pending-scan retries.
- Separate `warehouse` and `warehouse_supervisor` permissions in existing User Management. Admins have operational access. Supervisors can create locations, relocate and reprint; staff can receive, photograph, put away and request a first label print. Other ERP permissions are not implicitly granted.

## First use

1. Run the API against MongoDB Atlas or another replica set with transaction support. Standalone MongoDB is refused for warehouse writes; there is no non-atomic fallback.
2. Install dependencies in `server` and `client`, then start the existing applications normally.
3. In User Management grant **Warehouse staff** or **Warehouse supervisor**. Users should sign in again to refresh their navigation permissions. The API rechecks the current account for each request, so revocation is immediate.
4. Select a facility. Open **Stored Inventory → Locations** as an administrator/supervisor.
5. Create a `RECEIVING` area with a warehouse code such as `WH1`; create `RACK`, `SHELF` or `BIN` storage locations in that warehouse. Higher hierarchy levels are optional. Print and attach their labels.
6. Open **Receive**, find an existing customer, optionally select their contract and unit, and create five boxes. Record measurements if destinations have weight or volume limits.
7. Print/attach the five labels. In **Scan**, scan a receiving area and a box (either order), then confirm receipt.
8. Add a condition photo in the item details. Scan the box and the destination shelf, then confirm putaway. Repeat for all five boxes.
9. Inspect each item's history. It includes creation, receiving, photos, scans and putaway; supervisor relocation appends history instead of replacing it.

Photos are limited to 20 per item, 8 MB each, and kept in a separate protected MongoDB collection for the MVP. They are fetched as authenticated blobs, never placed in the application's public uploads directory. Plan private object storage if photo volume grows; keep the protected API contract.

## API

All endpoints below are under `/api/warehouse` and require an active employee with warehouse access.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/setup` | Minimal facility directory |
| GET | `/customers?search=…` | Minimal existing-customer lookup |
| GET | `/customers/:id/bookings` | Existing contracts and units |
| GET | `/summary?site=…` | Current inbound workload |
| GET / POST | `/locations` | Facility locations / supervisor creation |
| GET / POST | `/containers` | Paginated search / batch creation |
| GET | `/containers/:id` | Current state and photo IDs |
| GET | `/containers/:id/events` | Paginated permanent history |
| GET | `/containers/:id/suggestions` | Compatible locations ordered by code |
| POST | `/containers/:id/photos` | Private multipart photo upload |
| GET | `/photos/:id` | Authenticated image bytes |
| POST | `/scans` | Inspect, receive, put away or relocate |
| POST | `/labels` | Logged PDF label request |

Lists/summary require an explicit facility query. Object lookups and scans resolve globally unique codes; moving an item to another warehouse or facility is rejected. Warehouse permissions are company-wide, consistent with the existing staff model, not per-facility authorization.

Every mutation requires a client-generated UUID `requestId`. Retrying the same operation/body/actor returns the stored result; reusing the ID for different input is a conflict. Keep the complete original request for retries. Scan payloads include `barcode`, `action`, `deviceId` and, for movements, `locationBarcode`; relocation additionally requires `notes`.

State, capacity counters and event/receipt writes share a transaction. Competing moves serialize on the item and destination records, so stale reads cannot overfill a destination. Capacity is **direct occupancy**, not a roll-up of child locations. Missing measurements cannot bypass a configured limit. Suggestions are compatible locations ordered by code, not geometric route optimization.

The event model rejects save/update/delete/replace/bulk mutations. No HTTP update/delete routes exist for events or inventory. Production database credentials should also deny updates/deletes to `warehouse_scan_events`; database owners and direct-driver calls remain outside Mongoose middleware protections. Deploy indexes before operational traffic when automatic index creation is disabled. The unique `displayCode` and `requestId` indexes are correctness requirements.

## Connectivity behavior

The browser persists each scan command before sending it and removes it only after an acknowledged response. Pending scans are isolated by employee and survive reload. They block new scans until resolved. Retry retrieves the original result if the first request committed but its response was lost. Validation failures remain visible; staff may explicitly discard an incorrect command after reviewing it. No optimistic movement or capacity update occurs offline.

The app does not support an offline cold start, automatic replay, or offline photo upload. Opening the page requires the existing application to load. Reconnection exposes an explicit retry so staff can verify physical custody before continuing. Pending queue storage depends on browser storage remaining available; clearing site data clears it.

## Verification

`cd server && npm run test:warehouse` starts a disposable MongoDB replica set and does not read `.env` or touch the configured application database. First execution downloads a MongoDB test binary. Tests cover the five-box inbound scenario, duplicate requests, authorization, receiving/putaway prerequisites, concurrent capacity, transaction rollback, immutable history, private photos and labels.

Frontend checks: `cd client && npx tsc -b`, `npx vite build`, and targeted ESLint on `src/pages/warehouse`, `src/components/WarehouseScanner.tsx`, and `src/lib/warehouse.ts`.

`cd client && npm run test:warehouse` runs four browser tests with mocked API responses: scan prerequisites, customer/booking selection, durable scan retries, and mobile overflow. Windows uses installed headless Edge; other platforms use Playwright Chromium (`npx playwright install chromium`). The test server binds only to localhost. These complement the real-database API tests; they do not certify physical camera/scanner/printer hardware. Screenshots are written to the ignored `client/test-results` directory.

## Intentionally later phases

The brief's full receive-to-delivery acceptance scenario spans Phases 1–3. This change delivers its inbound Phase 1 portion. Customer **My Items**, retrieval orders, picking, packing, shipments, courier APIs/tracking, handover, notifications and configurable charges remain Phase 2/3 work. Business SKUs, stock allocation, marketplace orders, cycle counts, SLA dashboards and automation remain subsequent work. No fake courier integrations, billing changes, duplicate customer portal, or hard-coded prices are introduced.

Other explicit MVP limits: simple text contents, first-added photo as cover, fixed prefix conventions, immutable location definitions, and no general inventory-metadata editor. Packing/dispatch location types can be registered, but outbound movement actions are not enabled. The React warehouse screen works on mobile browsers; the separate native apps are unchanged.
