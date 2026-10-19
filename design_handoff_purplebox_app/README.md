# Handoff: PurpleBox Customer App (iOS + Android)

## Overview
A native mobile customer portal for **PurpleBox Storage** (Dubai self-storage). Customers manage their storage unit, pay bills, save cards, book pickup / drop-off / hourly-worker services, browse and multi-select stored items, view signed agreements, estimate storage size, refer friends for 10% off, and contact the facility.

Sample customer used throughout: **Layla Haddad, Haddad Home Goods LLC**, account `PB-20931`, **Unit L-114 (Large, 100 sqft)**, Warehouse 12, ABA Avenue, Al Quoz 2, Dubai.

## About the Design Files
The files in this bundle are **design references created in HTML**. They are a working prototype that shows the intended look and behaviour. They are **not production code to copy directly**. Recreate these designs in the target codebase's environment. Recommended: **React Native (Expo)** or **Flutter**, so one codebase ships to iOS and Android; SwiftUI + Jetpack Compose also work. Use the target platform's established patterns (navigation stacks, native sheets/dialogs, secure storage, biometrics APIs).

Open `PurpleBox App.dc.html` in a browser to click through everything. The Tweaks props at the bottom of the file switch `platform` (ios/android), `theme` (light/dark), `start` (app/onboarding) and `contractVideoUrl`.

## Fidelity
**High-fidelity.** Colours, type, spacing, radii, copy and interactions are final-intent. Pricing numbers are **placeholders** (to be supplied by PurpleBox). Contact email/website are placeholders to be confirmed.

## Platform approach
**Same UI on both platforms; only native chrome differs:**

| Element | iOS | Android |
|---|---|---|
| Root header | Large title 32px Bricolage 700, bell + headset icons top-right (40px targets) | 64px top app bar, title 24px Bricolage 700, bell + headset (48px targets) |
| Pushed header | 46px nav bar: "‹ Back" (brand text colour, 17px), centered 17px/700 title, optional text action ("Add") | 64px bar: ← icon (48px target), 22px/600 title left, optional icon action |
| Tab bar | 84px, translucent `--bar` + blur 20px, 26px icons, 10.5px/600 labels, active = `--brt` | 92px, `--sf2` bg, Material 3 active pill 64×32 r16 `--bsoft`, 24px icons, 12px labels (700 active / 500) |
| Confirm dialog | 270px alert, r14, blurred `--alert` bg, two equal buttons split by hairlines, destructive = red | 312px M3 dialog, r28, `--sf2`, 24px title, right-aligned text buttons |
| Biometrics | Face ID (scan-face icon), HUD 160×160 r30 centered | Fingerprint, bottom sheet "Verify it's you" |
| Home indicator | 134×5 bar | 108×4 gesture bar |
| Maps | Apple Maps | Google Maps |

## Navigation
Bottom tabs: **Home · Storage · Services · Payments · Account**. Each tab has its own push stack. Tab bar is hidden on pushed screens. Pushed screens that need a primary action get a **sticky footer** (12px 20px padding, top hairline, `--bg`) above the home indicator.

Global: the **headset icon** in every root header opens the **Support sheet**. The **bell** opens Notifications and clears the red unread dot.

## Screens / Views

### Onboarding (pre-auth)
1. **Welcome carousel**: 3 slides. Each has a 360px-tall r28 image, a 32px/700 Bricolage headline and 15.5px body. Dot indicator (active 24×8, inactive 8×8, r4, 250ms width transition). CTAs: "Create account" (primary) and "I already have an account" (outline).
   - "Storage that works around you." / "Private, air-conditioned units from 10 to 200 sqft in Al Quoz, with 24/7 access."
   - "We pick up. We drop off." / "Book a collection from your home or office, and get items delivered back when you need them."
   - "Your unit, in your pocket." / "Pay, track requests, browse stored items and open your agreements in one place."
2. **Create account**: Full name, Company (optional), Email, Mobile, Password (with 4-step strength meter: length ≥8, uppercase, digit, symbol → Too weak/Weak/Fair/Good/Strong; red/amber/green). Terms toggle. Validation on submit, with inline 12.5px/600 red messages under each field.
3. **Link your unit** (3 sub-steps, one pushed screen):
   - Find account: account or unit number (monospace input).
   - OTP: 6 boxes 58px tall r14. Hidden numeric input overlays them (`autocomplete=one-time-code`). Resend link.
   - Confirm unit: purple card with unit, holder, size, location, check-in. "Yes, link this unit" / "Not my unit — contact us" (opens support sheet).
4. **Enable biometrics**: 104px icon tile. "Turn on Face ID/fingerprint" / "Not now".
5. **Log in**: email, password, "Forgot password?", primary Log in (spinner while busy), divider "or", "Log in with Face ID/fingerprint". Error banner on bad credentials (`--erbg`/`--er`).
6. **Forgot password**: email → success state "Check your inbox" (mail-check icon, pop animation) + Resend.

After login a **skeleton loading state** (pulse 1.2s) shows on Home for ~1.4s.

### Home
Top to bottom, 20px side padding, 24px vertical gap:
- Greeting: "Good afternoon," 15px `--ink3`, name 26px Bricolage, company · account 13px.
- **Unit hero card**: `--brcard` bg, r26, 20px padding, shadow `0 14px 34px rgba(91,43,201,.28)`, decorative ring top-right. Chip "Access active · 24/7" with green dot. "Unit L-114" 34px/700. Sub-line "Large · 100 sqft · Warehouse 12, Al Quoz 2". A 2-col split shows Monthly AED 1,305 ("10% referral discount") and Next payment date ("Autopay · Visa •• 4242"). White pill button "Make a payment" (50px), which becomes a "October is paid — thank you" confirmation after paying. Tapping the card → Storage › Unit.
- **Quick actions** 2×2 grid: Request pickup, Request drop-off, View stored items, Storage estimator. Cards `--sf`, r20, 16px padding, 42px icon tile r13 `--bsoft`.
- **My contract**: a document card with a 62×78 mini page thumbnail, "Signed" green chip, `AGR-L114-2026`, "Self-storage agreement", "Signed 12 Mar 2026 · Renews 13 Mar 2027", "View contract" (requires biometric unlock if docs are locked). Below it, a **YouTube link row**: red 44×32 play tile, "Watch: your contract explained" / "A short overview of the key clauses · YouTube", external-link icon. Opens `contractVideoUrl` externally. "All documents" link → Storage › Documents.
- **Active requests** (max 2) with status chips, or a dashed empty state.
- **Upcoming dates** list: payment due (month/day tile), next pickup, check-out.
- **Notifications** preview (amber driver-on-the-way card, invoice ready card).
- **Refer banner** (`--sf2`, r22).
- "Need help? Contact PurpleBox" outline pill.

### Storage (segmented: Unit · Items · Documents)
iOS-style segmented control: `--sf2` track r12 3px padding. Active segment `--sf` r9 with a small shadow.

**Unit**: 170px photo (image slot) with "Air-conditioned" chip. Title + green "Active" chip. Two date tiles: Check-in 14 Mar 2026 and Check-out (current value, "Pending confirmation" amber if changed, "Change date" link → **Check-out sheet** with 4 radio options: keep / extend 6 mo / extend 12 mo (save 5%) / move out early). Info list: Location, Access (PIN masked `• • • •`, "Reveal PIN" needs biometrics → `4 8 1 9`), Billing plan, Agreement link. **Activity timeline**: 38px r12 icon tiles joined by 2px lines. States: done (`--bsoft`/`--brt`), current (`--wrbg`/`--wr`), future (dashed border).

**Items (inventory)**: search input 48px r14 with search icon + barcode-scan icon. Horizontal category chips (All, Stock, Furniture, Marketing, Equipment, Supplies, Documents, Seasonal). Active chip is ink-filled. Count line + "Select all in storage". Rows: 60px thumbnail r14, name + ×qty, monospace `label · category`, status chip (In storage ✓ green / Scheduled purple / Out for delivery amber / With you neutral). A 44px-target round checkbox (26px, brand fill when on). Items not in storage are 35% opacity, and tapping them shows a toast. **Multi-select**: when ≥1 selected, a sticky footer slides up (250ms) with × clear button + primary "Request delivery for N item(s)" → wizard (drop-off, step 2, items preselected). Empty search state: "No items match" + Clear search.

**Item detail**: 240px photo, status chip, 26px name, description, barcode block + label, spec rows (Label, Category, Quantity, Dimensions, Condition, Date stored), service history dots. Sticky "Request delivery" if in storage, otherwise an info note.

**Documents**: **locked by default**. Shield illustration, "Your documents are protected", "Unlock with Face ID/fingerprint". Once unlocked: filter chips (All, Agreements, Invoices, Receipts, IDs & licences). "My agreements" cards show title, ref · Unit L-114, status chip, Signed / Renewal-expiry columns. "Invoices, receipts & IDs" compact list. Footer "Stored with 256-bit encryption".

**Document preview**: white paper card (always light, even in dark mode) r14 with PurpleBox mark, ref, title, facility address, key/value rows, placeholder text lines for agreements, signature in italic serif. Meta row + status chip. Agreements also show Signed/Renewal tiles and the **YouTube "Watch the contract overview"** row. The "Awaiting signature" addendum shows "Review & sign". Sticky footer: Download (toast "Saved to Files › PurpleBox" / "Downloaded to Downloads/PurpleBox") + Share (share sheet).

### Services
"Book a service" card listing 4 services (42px icon tile rows, hover `--bsoft2`):
- Pickup to storage · from AED 250
- Drop-off to you · from AED 250
- Pickup & drop-off · from AED 450
- **Rent a worker** · "Help at your unit · AED 50/hour, min 1 hour"

Segmented Active (n) / History. Request rows show type, monospace ID, date · slot, status chip. Empty state: "Nothing scheduled".

**Request wizard** (pushed; progress bar 6px showing "Step X of 4" + step name; sticky footer shows estimate + Continue / Submit. The button sits at 45% opacity when the step is invalid, and tapping shows the reason as a toast):
1. **Service**: 4 radio cards (pickup, drop-off, both, worker).
2. **Items / Job details**:
   - Pickup: steppers for Boxes (AED 10 each) and Furniture & bulky (AED 40 each), description input, optional photo upload.
   - Drop-off: selectable list of in-storage items.
   - Both: both sections.
   - **Worker**: "What do you need help with?", rate chip "AED 50 per hour · minimum 1 hour", "Describe the job" textarea.
3. **Address & time** (worker: "Date & time"):
   - Address radio cards. Pickup/drop-off: Office, Home, + "Add a new address". **Worker: only "At my unit" (Unit L-114, Warehouse 12). Workers work at the storage facility only.** An info note says so.
   - **Month calendar**: Sep–Oct 2026, prev/next month buttons, Monday-first grid, 38px round day cells. Selected = brand fill, today = brand outline, past dates disabled. **Sundays disabled for worker bookings** (strikethrough).
   - Worker only: **Number of hours** stepper (1–12, min 1; − disabled at 1). **Start time** chips every 30 min from 08:00–19:00, in Morning / Afternoon / Evening 4-col grids (42px r12). Times that are booked (strikethrough) or that would finish after **20:00** are disabled. A **summary card** (`--brcard`) shows "Thu 24 Sep · 09:00 – 11:00", "2 hours at Unit L-114" and the total, or an amber warning if the combination is invalid.
   - Pickup/drop-off: "Arrival window" 2-hour slot grid (Full slots disabled; 18:00–20:00 +AED 50).
   - Notes textarea ("Instructions for the driver" / "Notes for our team").
4. **Review**: summary rows + price breakdown (Service fee / Handling / Evening slot; worker: "Worker · N h × AED 50") + "Estimated total". Note: charged only after completion.
- **Success**: 92px green check with pop animation, "Request received", reference, status Requested, when, estimate. "Track request" / "Back to home".

**Service pricing (placeholder)**: pickup 250, drop-off 250, both 450 base; boxes +10 each; bulky +40 each; delivered item +30 each; evening +50. **Worker = hours × 50 (min 1h).**

**Tracking** (pushed): header with type icon, when, status chip. If cancelled: red banner. If in progress: live map (image slot) with truck pin + ETA pill, driver row (initials avatar, name, van plate, rating, message + call buttons). Vertical **status stepper**: Requested → Confirmed → Scheduled → In progress → Completed, with timestamps. Current step has an amber dot with a 5px ring. Details: address, collection/booking description, item thumbnails, instructions, Estimate/Charged. "Cancel request" (outline red → confirm dialog: no charge >12h before). "Contact support".

**Service states & chip colours**: Requested (neutral), Confirmed / Scheduled (brand), In progress (amber), Completed (green), Cancelled (red).

### Payments
- **Balance card**: "Amount due" 40px Bricolage, due date, "Pay now" (52px). Paid state shows "You're all paid up". Autopay row with toggle (toast on change).
- **Saved cards** horizontal carousel: 200×124 r18 gradient cards (Visa `linear-gradient(135deg,#2D1259,#5B2BC9)`, Mastercard `#14081F→#4A4357`), nickname, brand mark, `•••• 4242`, expiry. Dashed "Add card" tile.
- Upcoming list and History list (tap → receipt preview).
- Security note: PCI-DSS provider, only last 4 digits seen.

**Pay flow**: invoice breakdown (Storage AED 1,450.00, Referral −145.00 green, Total 1,305.00), card radio list + "Add a new card", 3-D Secure note, sticky "🔒 Pay AED 1,305.00". Then **Processing** (64px spinner, 0.9s linear) → **Success** (check pop, amount, receipt RCP-2026-1001, "View receipt" / "Done"), or **Declined error** banner in the prototype when Mastercard •• 8810 is used. On success, Home and Payments update to the paid state and a new receipt appears in Documents.

**Saved cards screen**: full-width 190px cards with a "Default" badge, empty state, "Add a card".

**Add / Edit card**: a live card preview updates as the user types (brand detected from the first digit: 4 = Visa, 5 = Mastercard). Fields: number (auto-groups in 4s, 16 digits), name, expiry (auto "MM/YY", validated 01–12), CVV (password, 3–4 digits), nickname, "Set as default" toggle. Edit mode shows the masked number and only lets the user change expiry, nickname and default. "Remove card" → destructive confirm. Save shows a spinner (~0.9s), then toast "Card saved securely".

### Account
Profile card (56px initials avatar, name, company, monospace account ID, green "Verified" chip). **Refer & Save** banner (`--brcard`). **Security & preferences** group: Log in with Face ID/fingerprint (toggle; enabling requires a biometric prompt), Change password, Push notifications, Dark mode toggles. "Sign out" → destructive confirm. Version line.
(Storage and Support groups were intentionally removed. Those features are reachable from Home, the Storage tab, Payments and the headset icon.)

### Refer & Save
Hero `--brcard` r26: "10% off" 52px/800, "your monthly storage for every friend who joins PurpleBox.", "Your friend gets their first month at 20% off." Code button (dashed, monospace `LAYLA-10`, copy → toast) + white "Share" (native share sheet with the link `purpleboxstorage.ae/r/LAYLA-10`). The "Your monthly bill" breakdown shows the discount applied. "How it works" 4 steps: Invited → Signed up → Qualified → Reward applied. "Invite a friend by details" → **Invite form** (Full name, must be 2+ words; Mobile, ≥9 digits; Email, valid format). On send, the friend is added to the top of the list as Invited. Referral list: initials avatar, name, status chip, date · note, 4-segment progress bar.
Status chips: Invited (neutral), Signed up (brand), Qualified (amber), Reward applied (green).

### Storage estimator
Summary card: "Estimated volume" in cu ft (34px), item count, "We recommend" unit + sqft + price, a fill bar (% of recommended unit capacity), and a **5-unit comparison row** (Locker 10 / Small 25 / Medium 50 / Large 100 / XL 200 sqft) with mini bars. The recommended unit is highlighted in `--brcard`. Recommendation = smallest unit where volume ≤ 90% of capacity. Category chips with icons and count badges: Furniture, Bedroom, Living room, Appliances, Boxes, Office, Sports, Misc. Item rows with −/+ steppers (34px). "Clear all items". Sticky footer: "Reserve a {unit} unit" (confirm dialog, 48h hold) + "Get a quote" + "Request pickup".
Unit capacities (cu ft) / placeholder prices: Locker 70 / 250, Small 180 / 450, Medium 380 / 800, Large 780 / 1,450, XL 1,600 / 2,600. Per-item volumes are listed in the `EST` constant in the prototype.

### Contact PurpleBox
Map (image slot) with brand pin. "PurpleBox Storage", address, "Office open · closes 18:00" (green). 4 action tiles: Call, WhatsApp, Email, Directions (primary). Details list (tap-to-act):
- Office **04 329 3924**
- Mobile / WhatsApp **+971 54 224 9946**
- Email **hello@purpleboxstorage.ae** *(placeholder, confirm)*
- Website **purpleboxstorage.ae** *(placeholder, confirm)*
- Hours: Office Mon–Sat 09:00–18:00, Sun closed; Unit access 24/7.
"Contact support" → Support sheet.

**Support sheet** (global): WhatsApp (#1FA855 tile), Call the office, Email support, "Address, hours & directions" → Contact screen.

### Notifications
Grouped Today / Earlier cards with 38px tinted icon tiles; tapping deep-links to the related screen.

## Interactions & Behaviour
- **Toasts**: bottom 110px, `--toast` bg, r14, 14px/600, check icon, auto-dismiss 2.4s, slide-up 250ms.
- **Bottom sheets**: scrim `--scrim` fade 200ms. Sheet `--sf` r28 top corners, grab handle 36×5, slide-up 280ms ease-out, max-height 80%, tap scrim to close.
- **Dialogs**: pop-in 250ms (scale .5→1.08→1).
- **Biometric prompt**: ~1.2s simulated, then continues the action. Used for: login, enabling biometrics, unlocking documents, revealing the access PIN, opening the contract from Home.
- **Scroll resets to top** on every navigation change.
- **Keyframes**: `pbspin` (rotate 360°), `pbpulse` (opacity .5↔1), `pbpop`, `pbup` (translateY 40px→0 + fade), `pbfade`.
- **Toggles**: 51×31 track r99, 27px thumb, 200ms left transition. On = `--br`, off = `--sf3`.
- **Segmented controls**: 34px segments, 150ms bg transition.
- Minimum hit target 44px (iOS) / 48px (Android).

## Validation rules
- Email: `^[^@\s]+@[^@\s]+\.[^@\s]+$`
- Phone: ≥ 9 digits
- Password: ≥ 8 chars (login shows a generic "email and password don't match" error)
- Card: 16 digits, expiry `MM/YY` (01–12), CVV 3–4 digits, name required
- OTP: exactly 6 digits
- Invite full name: at least 2 words
- Worker booking: ≥ 1 hour, ≤ 12 hours, not Sunday, must end by 20:00, start time not booked

## State Management
Core entities (see the constants at the top of the logic class for full sample data):
- `customer` (name, company, account, verified)
- `unit` (id L-114, size, location, access PIN, check-in, check-out + pending flag, billing plan, status)
- `items[]` {id, name, label/barcode, category, qty, unit, status: stored|scheduled|transit|out, dims, condition, dateStored, description, history}
- `requests[]` {id SR-xxxx, type: pickup|dropoff|both|worker, status: requested|confirmed|scheduled|progress|completed|cancelled, date, slot/time range, address, itemIds, description, notes, price, statusLog{status: timestamp}}
- `documents[]` {id, kind: Agreement|Invoice|Receipt|ID, title, ref, status, signed, renew/expiry, size, rows}
- `payments[]`, `cards[]` {id, brand, last4, exp, name, nickname, isDefault} (store tokens only, never PAN)
- `referrals[]` {name, status: invited|signed|qualified|applied, date, note}
- UI: selectedItemIds, search query, category filter, docsUnlocked, autopay, biometricsEnabled, notifications, theme, wizard draft, pay status (review|processing|success|error)

Side-effects to wire to a backend:
- Submitting a request creates it (status requested) and marks its items `scheduled`.
- Cancelling reverts the items to `stored`.
- Payment success marks the invoice Paid and creates a receipt.
- Signing the addendum sets it Active.
- Changing check-out creates a pending change request.
- Referral status changes are driven by the server.

## Design Tokens
Fonts: **Bricolage Grotesque** (display/headings: 500–800, opsz 12–96) and **Plus Jakarta Sans** (UI/body: 400–800), both from Google Fonts. Monospace for IDs/labels/card numbers: platform mono (SF Mono / Roboto Mono).

### Colours
| Token | Light | Dark | Use |
|---|---|---|---|
| `--page` | #EDE7DC | #0B0614 | outside device |
| `--bg` | #FBF8F2 | #130A22 | screen background |
| `--sf` | #FFFFFF | #1D1231 | cards |
| `--sf2` | #F6F0E4 | #271A3E | secondary surface |
| `--sf3` | #EDE3CF | #33244F | tracks, skeletons |
| `--ink` | #14081F | #F5F1FB | primary text |
| `--ink2` | #4A4357 | #D2C9E0 | secondary text |
| `--ink3` | #716A7C | #A89EB9 | tertiary text |
| `--ln` | rgba(20,8,31,.09) | rgba(255,255,255,.08) | hairlines |
| `--ln2` | rgba(20,8,31,.18) | rgba(255,255,255,.2) | input borders |
| `--br` | #5B2BC9 | #7C4DFF | brand / primary |
| `--brcard` | #5B2BC9 | #4A1FA0 | hero cards (white text) |
| `--brt` | #4A1FA0 | #C9B6FF | brand text/links |
| `--bsoft` | #EDE5FF | rgba(124,77,255,.24) | tinted fills |
| `--bsoft2` | #F7F3FF | rgba(124,77,255,.12) | selected card bg |
| `--ok` / `--okbg` | #15803D / #DCF5E3 | #62E394 / rgba(98,227,148,.13) | success |
| `--wr` / `--wrbg` | #9A5406 / #FDF0D5 | #F6BD57 / rgba(246,189,87,.14) | warning / in progress |
| `--er` / `--erbg` | #B42318 / #FDE4E1 | #FF8F80 / rgba(255,143,128,.14) | error / destructive |
| `--toast` / fg | #14081F / #FFF | #EDE5FF / #14081F | toasts |
| `--scrim` | rgba(20,8,31,.42) | rgba(0,0,0,.55) | overlays |
| `--sh` | 0 1px 2px rgba(20,8,31,.05), 0 6px 18px rgba(20,8,31,.05) | none | card shadow |

Third-party: WhatsApp #1FA855, YouTube #FF0000.

### Type scale
Display 52/800 · H1 32–34/700 (-.03em) · H2 26–28/700 · H3 22–24/700 · Section 19/700 · Card title 17–18/700 (Bricolage). Body 15–16/500–600 · Row title 14.5–15/700 · Meta 12.5–13/500 · Caption/chip 11.5–12/700 · Overline 12/800 uppercase .1em tracking (Plus Jakarta Sans).

### Spacing & radius
Screen side padding 20px. Vertical rhythm 10 / 12 / 14 / 16 / 18 / 24px. Radii: chip/pill 999, button pill 999 (heights 42 / 46 / 50 / 52 / 54), input 14 (52px tall), list card 20, hero card 22–26, icon tile 11–14, sheet/Android dialog 28, iOS alert 14, device inner corner 48 (iOS) / 34 (Android).

## Assets
- **Icons**: [Lucide](https://lucide.dev) v0.469 (stroke 2, round caps). Use `lucide-react-native` or the equivalent package. Names used include: house, warehouse, truck, wallet, user-round, bell, headset, package-plus, arrow-left-right, hard-hat, boxes, ruler, credit-card, file-pen-line, file-text, receipt, badge-check, scan-face, fingerprint, shield-check, lock, key-round, map-pin, calendar-check, clock, gift, share-2, copy, message-circle, phone, mail, navigation, globe, download, trash-2, check, chevron-*, plus, minus, search, scan-barcode, info, circle-alert.
- **Logo**: placeholder purple rounded square with a box outline. Replace with the real PurpleBox logo.
- **Photos**: all imagery (onboarding slides, unit photo, item photos, live map, facility map) is placeholder `image-slot` elements. Supply real photography, and use a real map SDK (MapKit / Google Maps).

## Files
- `PurpleBox App.dc.html`: the complete clickable prototype (template + logic class with all sample data, validation and state transitions). Open in a browser.
- `support.js`: runtime needed to open the prototype locally.
- `pb-icon.js`: tiny Lucide icon web component used by the prototype.
- `image-slot.js`: drag-and-drop image placeholder used by the prototype.
