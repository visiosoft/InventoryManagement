# 005 — Fix the WhatsApp "unseen message" flash so it restarts on new messages, and gate it for reduced motion

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: HIGH
- **Category**: Interruptibility (AUDIT.md §4) + Accessibility (§6)
- **Estimated scope**: 1 file (`WhatsApp.tsx`), 1 CSS rule + 1 React effect

## Problem

`client/src/pages/WhatsApp.tsx:94,102-106`:
```css
const BLINK_MS = 4000
...
@keyframes wa-blink-bg { 0%, 100% { background-color: transparent; } 50% { background-color: rgba(91, 43, 201, 0.16); } }
.wa-blink { animation: wa-blink-bg 1s ease-in-out 4; }
```
applied at `WhatsApp.tsx:3770`:
```tsx
className={cn('wa-row ... transition-colors', blinking[c.phoneNormalized] ? 'wa-blink' : '')}
```
`animation: wa-blink-bg 1s ease-in-out 4` is a FINITE animation (4 iterations × 1s = 4s, matching `BLINK_MS`). `blinking[phone]` is set/extended on new inbound messages (`WhatsApp.tsx:2867-2891`, `until = Date.now() + BLINK_MS`), but because the applied class name (`wa-blink`) doesn't change value when `blinking[phone]`'s timestamp is merely extended — it's already `'wa-blink'` and stays `'wa-blink'` — React does not remount/retrigger the element, so the CSS animation (already running or already finished) does not restart. AUDIT.md §4: "keyframes restart from zero... anything triggered rapidly... must use transitions or springs" — this is the inverse failure mode of that warning (the keyframe should restart per new message and doesn't), on the single busiest page in the app, where the whole point of the indicator is "tell me a new message just arrived."

Separately, this rule has NO `prefers-reduced-motion` override anywhere in the file, unlike the sibling rule two lines below it:
```css
/* WhatsApp.tsx:114-118 — for comparison, the correct pattern already in this file */
.wa-menu-pop { ... }
@media (prefers-reduced-motion: reduce) { .wa-menu-pop { animation: none; } }
```

## Target

Force the animation to restart by keying the element (or a wrapper) on the blink epoch, so React actually swaps the DOM node's class application timing, and add the missing reduced-motion override:

```css
/* target — add directly below the existing rule at WhatsApp.tsx:106 */
@media (prefers-reduced-motion: reduce) {
  .wa-blink { animation: none; background-color: rgba(91, 43, 201, 0.16); }
}
```

```tsx
/* target — WhatsApp.tsx:3770 area */
<div
  key={blinking[c.phoneNormalized] ? `blink-${blinking[c.phoneNormalized]}` : 'no-blink'}
  className={cn('wa-row ... transition-colors', blinking[c.phoneNormalized] ? 'wa-blink' : '')}
  ...
>
```
Using the stored `until` timestamp (already present in the `blinking` state per-phone) as part of the `key` means every time `setBlinking` extends a conversation's timestamp for a NEW message, React sees a different `key` value and remounts that row's DOM node, restarting the CSS animation from 0% instead of letting an already-finished or in-flight one silently continue/expire.

## Repo conventions to follow

- The reduced-motion pattern to copy is right there in the same file: `WhatsApp.tsx:114-118`'s `.wa-menu-pop` override. Match its exact shape (a `@media (prefers-reduced-motion: reduce)` block redefining the same class), but per AUDIT.md §6 ("fewer and gentler, not zero") keep a static tinted background rather than fully removing the "new message" signal — `SalesBoard.tsx:794-796`'s own `.lead-new` reduced-motion override does exactly this (drops the loop, keeps a static color), and is the better model to copy here than `.wa-menu-pop`'s "animation: none" with no compensating static state.

## Steps

1. In `client/src/pages/WhatsApp.tsx`, immediately after the existing `.wa-blink { animation: wa-blink-bg 1s ease-in-out 4; }` rule (line 106), add:
   ```css
   @media (prefers-reduced-motion: reduce) {
     .wa-blink { animation: none; background-color: rgba(91, 43, 201, 0.16); }
   }
   ```
2. Find the row element at `WhatsApp.tsx:3770` that receives the `wa-blink` class (read enough surrounding context to confirm this is a mapped list item with access to `c.phoneNormalized` and the `blinking` state object).
3. Add or modify that element's `key` prop so it incorporates the blink epoch: if the element doesn't currently have an explicit `key` beyond the list `.map()`'s own key (check the enclosing `.map((c) => ...)` call — if `key={c.phoneNormalized}` or similar is already set on this exact element, you cannot simply add a second `key`; instead compose a single key string, e.g. `key={\`${c.phoneNormalized}-${blinking[c.phoneNormalized] || 0}\`}`). If the existing key is set on a PARENT element one level up rather than this exact `<div>`, move the compound key to whichever DOM node actually carries the `wa-blink` class, since that's the node that needs to remount for the animation to restart.
4. Confirm `blinking[c.phoneNormalized]` holds a distinct numeric value (the `until` timestamp) each time a new message arrives — re-read `WhatsApp.tsx:2867-2891` to confirm `setBlinking` always writes a NEW `Date.now() + BLINK_MS` value (not reusing an old one) whenever a new inbound message triggers it. If it does, this key strategy is guaranteed to change on every retrigger.

## Boundaries

- Do NOT change `BLINK_MS`, the 1s/4-iteration timing, or the visual color values — only fix the retrigger mechanism and add the reduced-motion branch.
- Do NOT change how/when `setBlinking` is called (the business logic for what counts as "new") — only how the resulting state is applied to the DOM.
- Do NOT touch `.wa-menu-pop` or any other rule in this file.

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check**:
  - Simulate (or wait for, if a test WhatsApp number is available) two inbound messages on the same conversation arriving ~2 seconds apart, while that row is visible but not the currently-open chat. Confirm the purple background flash visibly restarts/continues rather than cutting off after the first message's 4-second window.
  - Toggle `prefers-reduced-motion: reduce` in DevTools' Rendering panel, trigger a new-message blink, and confirm a static purple-tinted background appears (not zero indication, and not a looping flash).
  - Confirm no console key-collision warnings appear in the chat list after this change (React would warn about duplicate keys if the compound key isn't actually unique per row).
- **Done when**: `tsc`/`build` clean, a rapid burst of 2+ messages on one conversation visibly re-flashes rather than flashing once and stopping, and reduced-motion shows a static tint with no animation.
