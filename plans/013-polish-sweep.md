# 013 — Polish sweep: hover transitions, duplicated spinner, minor easing mismatches

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: LOW
- **Category**: Missed opportunities (AUDIT.md §8) + Cohesion & tokens (§7) + Accessibility (§6)
- **Estimated scope**: 8 files, 10 independent one-to-few-line fixes — each item below is self-contained; apply as many as time allows, in any order, each is safe to skip if it doesn't match current code

## Items

### 1. `client/src/components/WaitingStrip.tsx:71-125` — SLA-breach strip mounts with no transition
Current: `if (!data || data.count === 0) return null` — mounts/unmounts instantly, shoving page content down when it appears (polled every 20s via `refetchInterval: 20_000`).
Target: wrap the strip's outer element in a brief entrance — add local state `const [entered, setEntered] = useState(false)` set via `requestAnimationFrame` one frame after mount (same technique as plan 011), and apply `style={{ opacity: entered ? 1 : 0, transform: entered ? 'translateY(0)' : 'translateY(-4px)', transition: 'opacity 180ms ease-out, transform 180ms ease-out' }}` to the strip's root element. Keep the `return null` guard as-is (only wrap what's rendered when `data.count > 0`).

### 2. `client/src/components/AppFooter.tsx:125-134` — build-hash chip hover via raw JS style mutation
Current:
```tsx
onMouseEnter={(e) => { e.currentTarget.style.background = CHIP_HOVER }}
onMouseLeave={(e) => { e.currentTarget.style.background = CHIP_BG }}
```
No `transition` set anywhere on this element, so the swap is an instant cut. Target: add `transition: 'background 150ms ease'` to the chip's base inline `style` object (find it a few lines above/at the element itself), keeping the `onMouseEnter`/`onMouseLeave` handlers as-is (they already work functionally, they just need the CSS transition to actually ease the resulting color change).

### 3. `client/src/components/GlobalSearch.tsx:202-208` — search-result row hover has no transition
Current: `style={{ background: i === active ? '#F7F3FF' : '#fff' }}` with no transition. Target: add `transition: 'background-color 120ms ease'` to the same style object.

### 4. `client/src/pages/Leaderboard.tsx:86-99` — period-filter pills have no hover/transition at all
Current: `className="rounded-full px-4 py-1.5 cursor-pointer"` with conditional inline background/text-color styles, no transition. Target: add `transition-colors` to the className (matching the near-identical pattern already correct in `SalesBoard.tsx:215`'s `RENEWAL_OPTIONS` pills — check that file for the exact class list used there and mirror it).

### 5. `client/src/components/RentalFlowStepper.tsx:143-150` — connector rail missing `transition-colors` its sibling dot already has
Current: the step-dot (line 114) has `transition-colors`; the connector `<span>` right after it (lines 143-150) does not. Target: add `transition-colors` to the connector's className alongside its existing classes.

### 6. `client/src/pages/MyDay.tsx:224,377` — pulse dot uses `ease-in-out` on an infinite loop
Current: `@keyframes pbPulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }` applied via `animation: 'pbPulse 1.8s ease-in-out infinite'`. Target: change to `animation: 'pbPulse 1.8s linear infinite'` per AUDIT.md §2 ("constant motion → linear").

### 7. `client/src/pages/WhatsApp.tsx:4642` — `+`/`×` icon morph uses bare `ease` instead of `ease-in-out`
Current: `<Plus size={18} style={{ transform: toolsOpen ? 'rotate(45deg)' : 'none', transition: 'transform .15s ease' }} />`. Target: change `transition: 'transform .15s ease'` to `transition: 'transform .15s ease-in-out'` per AUDIT.md §2 ("moving/morphing on screen → ease-in-out").

### 8. `client/src/components/DashboardAsk.tsx:150-172,209-213` — border/shape and busy/answer panels teleport
Current: the ask-box's `border`/`borderRadius` flip instantly when an answer arrives; the busy/answer panels pop in via bare conditionals with no transition. Target: add `transition: 'border-color 200ms ease, border-radius 200ms ease'` to the box's style object (read the current full style object first to merge rather than clobber existing properties), and wrap the busy/answer panel's conditional render in the same fade-in technique as item 1 above (local `entered` state via `requestAnimationFrame`, `opacity`+small `translateY` transition, ~180ms).

### 9. `client/src/pages/WhatsApp.tsx:143-154,4744-4746` — quick-replies panel (`.wa-qr`) has no transition unlike its siblings
Current: `.wa-score`/`.wa-sidebar` both animate via `transform: translateX(...)` + `transition`; `.wa-qr` is purely conditionally mounted with no CSS transition rule at all. Target: add a `.wa-qr` CSS rule mirroring `.wa-sidebar`'s pattern (read `.wa-sidebar`'s exact rule at line 213 first and copy its shape, adjusting the slide direction/edge to match wherever `.wa-qr` is docked — check its `right`/`left` positioning before assuming a direction).

### 10. `client/src/pages/moving/ClientUpload.tsx:72-75,96,225` and `client/src/pages/moving/SharedJobView.tsx:51-54` — duplicated `@keyframes spin`, not reduced-motion-gated
Current: each of these 4 locations hand-declares `@keyframes spin { to { transform: rotate(360deg) } }` plus `animation: 'spin 1s linear infinite'`, duplicating Tailwind's built-in `animate-spin` utility (already used 34+ times elsewhere in this codebase, e.g. `components/ui.tsx`, `GlobalSearch.tsx`, `Approvals.tsx`, `Expenses.tsx`). Target: replace all 4 custom `<style>`/inline-`animation` blocks with the standard `animate-spin` Tailwind class. Since `animate-spin` itself has no reduced-motion gate in Tailwind's default config either, additionally wrap each spinner element's className with a manual reduced-motion override: add a small local CSS rule (or reuse a shared one if you create it once and reference from all 4 sites) — `@media (prefers-reduced-motion: reduce) { .pb-spin { animation: none; opacity: 0.6; } }` — applied via a `pb-spin` class alongside `animate-spin` (Tailwind's own class plus this override class together), so reduced-motion users get a static (dimmed, to still read as "busy") indicator instead of a spinning one.

### 11. `client/src/pages/moving/ClientUpload.tsx:144-145` — dropzone hover via ungated raw JS
Current: `onMouseEnter={e => (e.currentTarget.style.borderColor = PURPLE)}` / `onMouseLeave={...}` with no hover-capability check — on a page overwhelmingly opened on a client's phone, this can leave a stuck border-color state after a tap (no `mouseleave` fires reliably on touch). Target: replace with a CSS class using `@media (hover: hover) and (pointer: fine)` so the effect only applies on devices that support real hover — add a `.pb-dropzone:hover { border-color: ${PURPLE}; }` rule inside a `@media (hover: hover) and (pointer: fine) { }` block (in a `<style>` tag already present in this file, or a new small one), remove the `onMouseEnter`/`onMouseLeave` handlers, and add the `pb-dropzone` class to the element.

## Boundaries (applies to all 10 items)

- Each item is independent — if one doesn't match the current code (drift since commit `52c77bf`), skip just that one and report it; apply the rest.
- Do NOT refactor any surrounding logic, only the specific style/class/transition change described.
- Do NOT introduce new shared components for any of these — inline fixes only, consistent with each file's existing style (some use Tailwind classes, some use inline `style` objects — match whichever the surrounding code already uses).

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check**: spot-check at least 4 of the 10 items visually (hover the Leaderboard pills, watch the WaitingStrip appear after triggering an SLA breach if reproducible, toggle the WhatsApp tools `+`/`×` icon, load ClientUpload on a narrow/mobile viewport and confirm the spinner still spins and looks the same as before).
- **Done when**: as many of the 10 items as matched current code are applied, `tsc`/`build` clean, and no visual regression on the spot-checked items.
