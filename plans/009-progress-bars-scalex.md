# 009 — Animate progress/goal bars with `transform: scaleX()` instead of `width`

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: MEDIUM
- **Category**: Performance (AUDIT.md §5)
- **Estimated scope**: 2 files, 2 locations

## Problem

`client/src/pages/MyDay.tsx:567`:
```tsx
<span style={{ display: 'block', height: '100%', borderRadius: 7, background: fill, width: `${Math.round((n / maxCount) * 100)}%`, transition: 'width .2s ease' }} />
```
`client/src/pages/SalesBoard.tsx:342`:
```tsx
<div style={{ height: 8, borderRadius: 999, width: `${pct}%`, background: PURPLE, transition: 'width .3s' }} />
```
Both animate `width`, which AUDIT.md §5 explicitly lists as a layout-triggering property to avoid; both are on many-times-a-day pages (MyDay's lead-stage funnel, SalesBoard's goal progress).

## Target

Give each bar a fixed-width (100%) TRACK, and animate a `transform: scaleX()` FILL inside it, anchored left:
```tsx
{/* MyDay.tsx:567 target */}
<span style={{ display: 'block', height: '100%', width: '100%', borderRadius: 7, background: fill, transformOrigin: 'left', transform: `scaleX(${n / maxCount})`, transition: 'transform .2s ease-out' }} />
```
```tsx
{/* SalesBoard.tsx:342 target */}
<div style={{ height: 8, width: '100%', borderRadius: 999, background: PURPLE, transformOrigin: 'left', transform: `scaleX(${pct / 100})`, transition: 'transform .3s ease-out' }} />
```
Note the easing also changes from bare `ease`/unspecified to `ease-out` — AUDIT.md §2: entering/growing motion → `ease-out`.

## Repo conventions to follow

- Both bars already sit inside a fixed-width outer track element (confirm by reading a few lines above each cited line — e.g. `MyDay.tsx`'s funnel row and `SalesBoard.tsx`'s goal-bar row both wrap the animated element in a container with a defined width/flex-basis). If the OUTER wrapper does not already have an explicit `width: 100%` or an equivalent flex/grid sizing that fully determines the track's width independent of the inner element, add `width: '100%'` to the inner element's style (as shown in Target) so `scaleX` has a stable 100%-wide box to scale from — `scaleX` on an element whose own width is percentage-based off its (potentially also-changing) parent can look wrong if the parent itself isn't stable.

## Steps

1. In `client/src/pages/MyDay.tsx`, replace line 567's `style={{...}}` object per Target: remove the `width: '${...}%'` value, add `width: '100%'`, `transformOrigin: 'left'`, and `transform: 'scaleX(${n / maxCount})'`; change `transition: 'width .2s ease'` to `transition: 'transform .2s ease-out'`.
2. In `client/src/pages/SalesBoard.tsx`, apply the equivalent change to line 342, using `pct / 100` as the scale factor (confirm `pct` is already a 0-100 number by reading its computation a few lines above — if it's already a 0-1 fraction rather than a 0-100 percentage, use `pct` directly instead of `pct / 100`).

## Boundaries

- Do NOT change the underlying `n`/`maxCount`/`pct` calculation logic — only how the resulting fraction is applied visually.
- Do NOT change the bar's color, height, or border-radius.

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check**: on MyDay's lead-stage funnel and SalesBoard's goal card, confirm each bar still visually fills to the correct proportion and animates smoothly when the underlying count/percentage changes (e.g. navigate away and back, or trigger a refetch) — the fill should grow from the left edge, not scale from center or the right.
- **Done when**: both bars use `transform: scaleX()`, `tsc`/`build` clean, and the visual fill proportions match what they showed before the change (verify against the same data).
