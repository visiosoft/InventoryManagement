# 008 — Animate accordion content reveals to match their already-animating chevrons

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: MEDIUM
- **Category**: Missed opportunities (AUDIT.md §8)
- **Estimated scope**: 3 files (`Layout.tsx`, `PipelineFunnel.tsx`, `FollowUpDrawer.tsx`), 4 accordion instances

## Problem

Four accordion toggles rotate their chevron smoothly but the content they reveal pops in/out with a hard `{open && (...)}` unmount — self-contradictory within each component (one part animates, the sibling doesn't). AUDIT.md §8: "State changes that teleport... where a brief transition would prevent a jarring change."

1. `client/src/components/Layout.tsx:584` (chevron) / `:586-594` (Reports submenu body):
```tsx
<ChevronDown ... className={cn('transition-transform duration-200', reportsOpen ? 'rotate-180' : '')} />
{reportsOpen && (<div className="ml-2.5 mt-0.5 ...">...</div>)}
```
2. Same pattern at `Layout.tsx:656` (Moving Reports submenu chevron) vs. its body.
3. `client/src/components/PipelineFunnel.tsx:43-47` (chevron) vs. `:50-85` (funnel body).
4. `client/src/components/FollowUpDrawer.tsx:253-271` (WhatsApp-template picker) and `:331-339` (Full history list) — both use a chevron swap (`pickerOpen ? <ChevronUp/> : <ChevronDown/>`, not a CSS rotation, but same teleport-content issue) with a hard-conditional body.

## Target

For the two CSS-rotation cases (Layout.tsx, PipelineFunnel.tsx) — fade + slide the revealed block in alongside the existing chevron rotation, using a `grid-template-rows` 0fr→1fr technique so height doesn't need a hardcoded pixel value (per AUDIT.md §8: prefer `translate` percentages / techniques that don't hardcode pixel offsets):
```tsx
{/* target — wrap the existing conditional body in an animated grid track instead of {open && (...)} */}
<div
  className="grid transition-[grid-template-rows] duration-200 ease-out"
  style={{ gridTemplateRows: reportsOpen ? '1fr' : '0fr' }}
>
  <div className="overflow-hidden">
    {/* existing Reports submenu content, now always rendered, clipped by the 0fr track when closed */}
  </div>
</div>
```
For the two icon-swap cases in `FollowUpDrawer.tsx` — same `grid-template-rows` technique, driven by `pickerOpen`/`historyOpen`, plus rotate the chevron for consistency with the other two files:
```tsx
<button onClick={() => setPickerOpen((v) => !v)}>
  ... <ChevronDown className={cn('transition-transform duration-200', pickerOpen && 'rotate-180')} />
</button>
<div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: pickerOpen ? '1fr' : '0fr' }}>
  <div className="overflow-hidden">{/* existing template-picker content */}</div>
</div>
```
(Replace the separate `<ChevronUp/>`/`<ChevronDown/>` swap with a single `<ChevronDown>` that rotates, matching the Layout.tsx/PipelineFunnel.tsx convention, unless `ChevronUp` is used for some other unrelated visual reason in this file — check before removing it.)

## Repo conventions to follow

- `transition-transform duration-200` on the chevron is already the established convention (`Layout.tsx:584`) — do not change the chevron's own transition, only add the matching content-reveal transition alongside it.
- The `grid-template-rows: 0fr → 1fr` technique keeps the animation to `grid-template-rows` (a modern, GPU-friendly technique that avoids hardcoding a pixel height) rather than animating `height`/`max-height` directly (which AUDIT.md §5 would flag as a layout property) — `grid-template-rows` on a `display: grid` container with `overflow: hidden` on the child achieves a real auto-height reveal without triggering the same width/height reflow finding.

## Steps

1. In `client/src/components/Layout.tsx`, locate the Reports submenu block (~lines 584-594) and Moving Reports submenu block (~line 656 and its body). For each, replace `{reportsOpen && (<div className="ml-2.5 mt-0.5 ...">...</div>)}` with the `grid`/`gridTemplateRows` wrapper from Target, keeping the existing inner className/content untouched inside the new `overflow-hidden` wrapper.
2. In `client/src/components/PipelineFunnel.tsx`, apply the same transformation to the funnel body (currently lines 50-85, revealed by the chevron at lines 43-47).
3. In `client/src/components/FollowUpDrawer.tsx`, apply the same transformation to both the template-picker body (lines 253-271) and the full-history body (lines 331-339), additionally normalizing the chevron to a single rotating `ChevronDown` per Target (only if `ChevronUp` isn't used for another purpose in this file — grep for other `ChevronUp` usages first).

## Boundaries

- Do NOT change the content INSIDE any of these 4 accordion bodies — only how they mount/reveal.
- Do NOT introduce a new easing token for this — plain `ease-out` here is fine (short, small-scale UI reveal within the 150-250ms dropdown budget).
- If any of the 4 bodies contains something that breaks when always-rendered-but-clipped instead of conditionally-mounted (e.g. an effect that assumes it only runs while "open," or a form that should reset when closed), STOP on that specific instance and report — apply the fix to the other 3.

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check** (all 4): toggling the accordion should now show the content sliding/fading open in sync with the chevron's rotation — both should visually complete together, not one instant and one animated. Rapidly toggle each several times: no stuck partial-height state.
- **Done when**: all 4 accordions animate their reveal, `tsc`/`build` clean.
