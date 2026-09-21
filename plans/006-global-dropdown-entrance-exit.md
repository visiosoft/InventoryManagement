# 006 — Give the global chrome dropdowns (profile menu, WhatsApp bell, search results) real entrance/exit motion

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: MEDIUM
- **Category**: Missed opportunities (AUDIT.md §8) + Cohesion & tokens (§7)
- **Estimated scope**: 3 files (`Layout.tsx`, `WhatsAppBell.tsx`, `GlobalSearch.tsx`)

## Problem

Three global-chrome dropdowns are bare `{open && (<div className="absolute ...">...)}` mounts with no `transition`/`transform`/`opacity` motion anywhere — they snap into and out of existence:

- `client/src/components/Layout.tsx:842-974` — the profile menu (a wide, two-column dropdown, present on every page).
- `client/src/components/WhatsAppBell.tsx:112-167` — the unread-WhatsApp dropdown (global chrome, every page).
- `client/src/components/GlobalSearch.tsx:185-223` — the search-results panel (global chrome, every page).

This directly contradicts a working pattern one file over: `components/ui.tsx`'s `Modal`/`SlideOver` (lines 257-367) already implement `usePresence(open, exitMs)` plus a fade-and-scale-from-trigger entrance/exit at `cubic-bezier(0.23,1,0.32,1)`. AUDIT.md §3: "Popovers/dropdowns/tooltips scale from their trigger, not center," and §7 flags this exact kind of "some components animate, most don't" inconsistency.

## Target

Reuse `usePresence` (already exported implicitly via its use inside `ui.tsx` — see Steps for how to make it reusable) to give each dropdown a fade + slight scale/translate entrance anchored at its trigger corner (top-right for all three, since all three are corner-anchored dropdowns hanging below a top-right/top-bar trigger):

```tsx
/* target shape, applies to all 3 */
const { rendered, entered } = usePresence(open, 160)
if (!rendered) return null
return (
  <div
    className="absolute ..." // keep each component's existing positioning classes
    style={{
      transformOrigin: 'top right',
      opacity: entered ? 1 : 0,
      transform: `scale(${entered ? 1 : 0.96})`,
      transition: 'transform 160ms cubic-bezier(0.23,1,0.32,1), opacity 160ms cubic-bezier(0.23,1,0.32,1)',
    }}
  >
    {/* existing content, unchanged */}
  </div>
)
```
(160ms rather than `Modal`'s 200ms / `SlideOver`'s 220ms — these are smaller, popover-class UI, and AUDIT.md's duration table puts "Tooltips, small popovers" at 125-200ms, distinct from the 200-500ms modal/drawer band.)

## Repo conventions to follow

- `usePresence` currently lives as a private (non-exported) function inside `client/src/components/ui.tsx:24-40`. To reuse it in 3 other files, export it: add `export` to its declaration (`export function usePresence(...)`). This is the only change allowed to `ui.tsx` in this plan — do not modify its internals.
- Reuse the exact same reduced-motion pattern as `Modal`/`SlideOver`: call `prefersReducedMotion()` (also needs `export`ing from `ui.tsx` for the same reason) and skip the `transform`/`scale` when true, keeping only the opacity fade — per AUDIT.md §6 and the pattern already correct in `Modal`/`SlideOver`.
- Match each dropdown's own existing corner: read each component's current positioning classes (e.g. `right-0`, `left-0`) before setting `transformOrigin` — a dropdown anchored to the left of its trigger needs `transformOrigin: 'top left'`, not `'top right'`.

## Steps

1. In `client/src/components/ui.tsx`, change `function usePresence(...)` to `export function usePresence(...)` and `function prefersReducedMotion()` to `export function prefersReducedMotion()`. No other change to this file.
2. In `client/src/components/Layout.tsx`, import both: `import { usePresence, prefersReducedMotion } from './ui'` (adjust the relative path if `Layout.tsx` already imports something from `./ui` — add to that existing import instead of a new line). Locate the profile-menu block (~lines 842-974: find the `{profileMenuOpen && (` or equivalent conditional — re-grep for the trigger state variable name at edit time, since `842` is an approximate line from the audit pass). Wrap it in the `usePresence`/`rendered`/`entered` pattern per Target, preserving all existing inner content and positioning classes (`absolute`, `right-*`, `top-*`, width, etc.) — only add the `style` object for the fade/scale.
3. Repeat step 2's transformation in `client/src/components/WhatsAppBell.tsx:112-167` and `client/src/components/GlobalSearch.tsx:185-223`, each importing `usePresence`/`prefersReducedMotion` from `../components/ui` (adjust relative path per each file's actual location).
4. For each of the 3, confirm the `transformOrigin` matches that dropdown's actual anchor corner by reading its current CSS positioning (don't assume `top right` for all three without checking).

## Boundaries

- Do NOT change the CONTENT or layout inside any of the 3 dropdowns — only wrap the outer container with the presence/fade/scale treatment.
- Do NOT touch `Modal`/`SlideOver` themselves beyond exporting the two helper functions.
- Do NOT add this treatment to any OTHER dropdown/menu in the app not named above — scope is exactly these 3 files.

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check** (repeat for all 3):
  - Open each dropdown: confirm a brief (~160ms) fade+scale-in from its trigger corner, not an instant pop.
  - Close it (click elsewhere / click the trigger again): confirm it fades/scales back out rather than vanishing instantly.
  - Rapidly click the trigger open-close-open several times: confirm no stuck/duplicated panel and no visual jump.
  - Toggle `prefers-reduced-motion: reduce`: confirm each dropdown still fades in/out but no longer scales.
- **Done when**: all 3 dropdowns visibly animate open and closed, `tsc`/`build` are clean, and rapid re-triggering shows no glitches.
