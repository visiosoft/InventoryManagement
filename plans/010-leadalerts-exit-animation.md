# 010 — Give the lead-alert toast queue a real exit animation

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: MEDIUM
- **Category**: Interruptibility (AUDIT.md §4)
- **Estimated scope**: 1 file (`LeadAlerts.tsx`)

## Problem

`client/src/components/LeadAlerts.tsx:114,199-262`: the lead-alert toast queue holds up to 4 items (state `queue`), each entering via `animation: 'pb-lead-alert-in .22s ease-out'` (a `@keyframes`, `LeadAlerts.tsx:265-268`) and each removed — via the 12s auto-clear `setTimeout(() => setQueue(prev => prev.slice(1)), 12_000)`, the manual `X` dismiss button, or a `Link` `onClick` — by an instant `setQueue` update that unmounts the item with no exit transition at all. AUDIT.md §4 flags asymmetric timing (animated in, zero-duration out) as a finding — the dismissal should feel like the reverse of the arrival, not an abrupt cut.

## Target

Wrap each queue item in a small local "leaving" state so it can play a matching ~200ms fade+translate-out before being spliced from `queue`:
```tsx
// target shape — inside the component that renders each queued item
const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set())

function dismiss(id: string) {
  setLeavingIds((prev) => new Set(prev).add(id))
  setTimeout(() => {
    setQueue((prev) => prev.filter((item) => item.id !== id))
    setLeavingIds((prev) => { const next = new Set(prev); next.delete(id); return next })
  }, 200) // matches the exit animation duration below
}
```
```css
/* target — add next to the existing pb-lead-alert-in keyframe, LeadAlerts.tsx ~268 */
@keyframes pb-lead-alert-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(12px); } }
```
```tsx
/* target — applied to each rendered item */
style={{ animation: leavingIds.has(item.id) ? 'pb-lead-alert-out .2s ease-in' : 'pb-lead-alert-in .22s ease-out' }}
```
(Exit uses `ease-in` deliberately here, as an exception to AUDIT.md §2's general "entering/exiting → ease-out" guidance — the rubric's own decision order lists `ease-out` for both, but a fast fade-and-slide DISMISSAL reads more naturally accelerating away; if you want to stay strictly within AUDIT.md's literal guidance instead, use `ease-out` for both directions — either is acceptable, but be consistent and pick one.)

## Repo conventions to follow

- Every existing call site that currently does `setQueue((prev) => prev.slice(1))` or removes an item directly (the 12s auto-clear at whatever line currently has it, the `X` button's `onClick`, and each `Link`'s `onClick` handler at lines 133/237/244/254) must be changed to call the new `dismiss(item.id)` helper instead of mutating `queue` directly — otherwise some removal paths will still skip the exit animation.
- Reuse the existing reduced-motion block (`LeadAlerts.tsx:269-271`, which plan 012 also touches — coordinate: after both plans, that block should end up covering BOTH `pb-lead-alert-in` and `pb-lead-alert-out`, keeping opacity but dropping `transform` for each, per plan 012's fix).

## Steps

1. Add the `leavingIds` state and `dismiss(id)` helper (per Target) to the component in `LeadAlerts.tsx` that owns `queue`.
2. Add the `pb-lead-alert-out` keyframe next to the existing `pb-lead-alert-in` one.
3. Find every place `queue` items are currently removed (the 12s `setTimeout`, the `X` dismiss button, and the `Link` `onClick` handlers referenced above) and change each to call `dismiss(item.id)` instead of directly slicing/filtering `queue`.
4. Apply the conditional `animation` style (entering vs. leaving) to each rendered queue item per Target.
5. Ensure `queue` items have a stable, unique `id` field already (check the shape pushed into `queue` when a new alert arrives) — `leavingIds`/`dismiss` depend on it. If items don't already carry a stable id, use whatever unique field is already present (e.g. a lead id or timestamp) instead of inventing a new one.

## Boundaries

- Do NOT change the 12-second auto-clear duration or the arrival/polling logic — only how removal is animated.
- Do NOT change the entrance animation or its duration.

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check**: trigger a lead alert (or wait for the natural 20s poll to surface one), let it auto-clear after 12s — confirm it fades/slides out rather than vanishing instantly. Manually dismiss one via the `X` button and via clicking its link — confirm both paths animate out the same way. With 2+ alerts queued, dismiss the top one and confirm the remaining ones reflow smoothly rather than snapping up.
- **Done when**: every removal path (auto-clear, `X`, link click) shows the exit animation, `tsc`/`build` clean.
