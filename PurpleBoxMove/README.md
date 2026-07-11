# PurpleBox Move — full-stack moving app

A moving-request platform for **PurpleBox**. Customers log in by phone, build a move request (date, addresses, home size, photos, walkthrough video, add-ons) and submit it. The ops team reviews it and sends a fixed quote; the customer accepts and tracks the move.

```
PurpleBoxMove/
├── app/      React Native (Expo + TypeScript) — the customer mobile app
└── server/   Node.js + Express + MongoDB (Mongoose) — the API + media storage
```

The app runs **standalone in demo mode** (no server needed — it falls back to local behaviour), and becomes a **real, persisted app** the moment the server is running.

---

## Prerequisites

- **Node.js 18+**
- **MongoDB** — either local ([Community Server](https://www.mongodb.com/try/download/community)) or a free **MongoDB Atlas** cluster
- **Expo Go** app on your phone, or an iOS Simulator / Android Emulator

---

## 1) Start the backend

```bash
cd server
npm install
copy .env.example .env      # Windows  (macOS/Linux: cp .env.example .env)
# edit .env → set MONGO_URI and JWT_SECRET
npm run seed:admin          # optional: creates an ops/admin login
npm run dev                 # starts on http://localhost:4000
```

Check it's alive: open `http://localhost:4000/api/health` → `{ "ok": true }`.

With `DEMO_OTP=true` (default) the SMS code is returned by the API and any 4-digit code is accepted — so you don't need a real SMS provider to test.

## 2) Start the app

```bash
cd app
npm install
npx expo start
```

Open in Expo Go (scan QR) or press `i` / `a` for a simulator/emulator.

### Point the app at your server
Edit **`app/src/api.ts`** → `API_BASE`:
- Android emulator → `http://10.0.2.2:4000`
- iOS simulator → `http://localhost:4000`
- **Real phone** → `http://<your-computer-LAN-IP>:4000` (e.g. `http://192.168.1.20:4000`), and set the same in `server/.env` `PUBLIC_URL` so uploaded photos load on the device.

---

## How the pieces connect

| Step in the app | API call | Server effect |
|---|---|---|
| Login → Continue | `POST /api/auth/request-otp` | creates/updates user, issues OTP |
| OTP → Verify | `POST /api/auth/verify-otp` | returns a JWT (30-day) |
| Review → Submit | `POST /api/moves` → `POST /api/moves/:id/media` (per photo/video) → `POST /api/moves/:id/submit` | stores the request + uploads, status `pending_review` |
| Submitted (polling) | `GET /api/moves/:id` every 4s | advances when status becomes `quoted` |
| Quote → Accept | `POST /api/moves/:id/accept` | status `accepted`, tracking starts |

### Ops / admin side (send the quote)
The admin endpoints are protected (`role: admin`). After `npm run seed:admin`, log in via `POST /api/auth/admin-login` to get an admin token, then:

- `GET  /api/admin/moves?status=pending_review` — inbox of requests to price
- `POST /api/admin/moves/:id/quote` — send a quote (omit `lines` to auto-price, or pass your own `[{label, amount}]`)
- `POST /api/admin/moves/:id/status` — advance tracking (`{ "status": "in_progress", "stepIndex": 2 }`)

You can drive these with Postman/curl today; a small web admin panel is the natural next addition.

---

## Data model (MongoDB)

- **User** — `phone`, `role` (`customer` | `admin`), OTP fields, optional admin `passwordHash`.
- **Move** — schedule, locations, `homeSize`, `notes`, `photos[]`, `video`, `addons`, `status`, `quote{lines,subtotal,vat,total}`, `tracking[]`, and a human `reference` (e.g. `PB-4821`).

## Going to production (checklist)

- Replace demo OTP with a real SMS provider (Twilio/Unifonic) — see the `TODO` in `server/src/routes/auth.js`.
- Move media uploads from local disk to **S3 / Cloudinary** (swap `server/src/middleware/upload.js`).
- Add persistent token storage in the app (`expo-secure-store`) so login survives restarts.
- Add push notifications (`expo-notifications`) so quotes/updates reach the customer.
- Build the ops admin panel (web) on top of the existing admin API.
- Deploy: server → Render/Railway/Fly + MongoDB Atlas; app → EAS Build to the App Store / Play Store.

## Notes
- Fonts: Bricolage Grotesque (display) + Plus Jakarta Sans (body). If `@expo-google-fonts/bricolage-grotesque` isn't in your registry, swap the two imports in `app/App.tsx` (see `app/README.md`).
- The original clickable HTML prototype (`Moving App.dc.html`) in the parent workspace is the visual reference this codebase implements.
