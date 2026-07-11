# PurpleBox Move — React Native (Expo) app

A moving-request app for **PurpleBox**. A customer logs in, builds a move request (date, addresses, home size, photos, walkthrough video, add-ons), submits it for review, then receives a quote and tracks the move.

Built with **Expo (SDK 51) + React Native + TypeScript**. This is a real, runnable codebase — not an HTML export.

---

## Requirements

- **Node.js 18+**
- **npm** (or yarn/pnpm)
- The **Expo Go** app on your phone (iOS App Store / Google Play), or an iOS Simulator / Android Emulator.

## Run it

```bash
cd purplebox-move
npm install
npx expo start
```

Then:
- Scan the QR code with **Expo Go** (Android) or the **Camera** app (iOS), **or**
- Press `i` for the iOS simulator, `a` for the Android emulator.

> If Metro complains about a package version, run `npx expo install` once — it aligns native modules to your installed SDK.

---

## The flow

Log in with **any phone number** and **any 4 digits** for the code (demo auth). On the login screen a **Flow style** toggle picks between the two navigation models:

- **Guided wizard** — one step at a time with a "Step X of 7" progress marker. Best for first-time users.
- **Flexible hub** — a "move plan" screen where sections can be completed in any order. Faster for repeat users.

Screens: **Login → OTP → (Hub) → Moving date → Pickup & drop-off → Home & items → Photos → Video → Add-ons → Review → Submitted → Quote → Tracking.**

The quote arrives via a **"Simulate quote ready"** button on the Submitted screen — in production this would be a push notification sent after your team reviews the request.

## What's real vs. mocked

- **Real:** photo & video selection use `expo-image-picker`. When the backend (`../server`) is running, login, submitting the request, media upload, quote polling, and accept are all **live and persisted to MongoDB** (see `src/api.ts` and the root `README.md`).
- **Offline demo:** every network call is wrapped in try/catch and falls back to local behaviour, so the UI runs fully without the server.

### Connect to the backend
Set `API_BASE` in **`src/api.ts`** to your server address (Android emulator `http://10.0.2.2:4000`, iOS sim `http://localhost:4000`, real device your LAN IP). See the root `README.md` for the full flow.

---

## Project structure

```
purplebox-move/
├── App.tsx              # Font loading + providers + Router mount
├── app.json            # Expo config (name, permissions, plugins)
├── package.json
├── babel.config.js
├── tsconfig.json
└── src/
    ├── api.ts          # Backend client (auth, create move, upload, poll, accept)
    ├── core.tsx        # Theme (colors/fonts), state (Context + reducer),
    │                   # navigation helpers, quote math, shared UI (buttons, TopBar, Footer)
    └── screens.tsx     # All 13 screens + the Router that switches on state.screen
```

State is a single `useReducer` in `MoveProvider` (`src/core.tsx`), exposed through the `useMove()` hook. Navigation is a screen-name state machine (`go` / `advance` / `back`) — no external navigation library, so there's nothing extra to configure.

## Design tokens (`src/core.tsx` → `C`, `F`)

- **Brand purple** `#5B2BC9` · dark `#4A1FA0` · light tint `#F7F3FF` · badge `#EDE5FF`
- **Ink** `#14081F` · secondary `#4A4357` · muted `#756E80`
- **Paper** background `#FBF8F2`
- **Success** `#1F8A5B` on `#E7F7EE`
- **Fonts:** Bricolage Grotesque (display / headings), Plus Jakarta Sans (body) — loaded from `@expo-google-fonts/*`.

## Backend hooks (where to connect your API)

- `OtpScreen` → `verify()` : send/confirm the SMS code.
- `ReviewScreen` → "Submit request" (`go('submitted')`) : POST the move request + uploaded media.
- `SubmittedScreen` → replace the "Simulate quote ready" button with a push-notification listener; navigate to `quote` when the quote lands.
- `QuoteScreen` → `quoteFor(state)` in `core.tsx` currently computes the price locally; swap it for your quoted figures.
- `TrackingScreen` → feed the `steps` array from your order-status endpoint.

## Notes

- Icons use `@expo/vector-icons` (Feather) as stand-ins for the prototype's Lucide set.
- If `@expo-google-fonts/bricolage-grotesque` fails to resolve in your registry, swap those two imports in `App.tsx` for any display font (e.g. `@expo-google-fonts/space-grotesk`) and update the `Bricolage` / `Bricolage-XB` keys — the rest of the app is unaffected.
- The original clickable HTML prototype (`Moving App.dc.html`) lives in the parent project as the visual reference.
