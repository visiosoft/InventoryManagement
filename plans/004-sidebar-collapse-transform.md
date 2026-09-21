# 004 — Animate the sidebar collapse with `transform`, not `width`/`margin-left`

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: HIGH
- **Category**: Performance (AUDIT.md §5)
- **Estimated scope**: 1 file (`Layout.tsx`), 1 structural change touching 2 elements

## Problem

`client/src/components/Layout.tsx:748` and `:817`:
```tsx
// Desktop sidebar
<aside className={cn("hidden md:flex fixed inset-y-0 left-0 bg-sidebar text-sidebar-foreground flex-col z-30 shadow-xl transition-all duration-200", collapsed ? 'w-[60px]' : 'w-56')}>
  {SidebarContent({ isCollapsed: collapsed })}
  ...
</aside>

// Main content, offset to clear the fixed sidebar
<main className={cn("flex-1 pt-14 md:pt-0 min-w-0 transition-all duration-200", collapsed ? 'md:ml-[60px]' : 'md:ml-56')} style={{ background: '#FBF8F2' }}>
```
Toggling the sidebar collapse animates `width` (on `<aside>`) and `margin-left` (on `<main>`) — both explicitly called out in AUDIT.md §5: "`width`/`height`/`margin`/`padding`/`top`/`left` trigger layout + paint + composite." This is the single element present on every page of the app.

## Target

Keep `<aside>` always rendered at its EXPANDED width (`w-56` = 224px) so nothing about its own box model changes on collapse. Wrap it in a fixed-width, `overflow-hidden` outer shell that only shows 60px of it when collapsed, and slide the 224px-wide inner content left via `transform: translateX()` so the "hidden" portion moves off-canvas instead of the box shrinking:

```tsx
{/* Desktop sidebar — outer shell owns the visible width, never animates it */}
<div className={cn("hidden md:block fixed inset-y-0 left-0 z-30 overflow-hidden transition-[width] duration-200", collapsed ? 'w-[60px]' : 'w-56')}>
  {/* Inner content stays full width always; only its position changes */}
  <aside
    className="flex flex-col h-full w-56 bg-sidebar text-sidebar-foreground shadow-xl"
    style={{ transform: collapsed ? 'translateX(-164px)' : 'translateX(0)', transition: 'transform 200ms cubic-bezier(0.23,1,0.32,1)' }}
  >
    {SidebarContent({ isCollapsed: collapsed })}
    <button ...>{/* unchanged */}</button>
  </aside>
</div>

<main className={cn("flex-1 pt-14 md:pt-0 min-w-0")} style={{ background: '#FBF8F2', transform: collapsed ? 'translateX(calc(-164px * 0))' : undefined }}>
```

Wait — `<main>`'s offset cannot be solved with a `transform` the same way, because `margin-left` here is reserving LAYOUT SPACE for the fixed sidebar (not visually sliding `<main>` itself); a `transform` on `<main>` would move it visually but not reclaim/reserve space the way `margin-left` does, and `<main>` isn't `position: fixed` so it can't just overlap. **This one property genuinely needs a layout-affecting value to change** — there is no correct transform-only substitute for "reserve less horizontal space." AUDIT.md's own performance section is about avoiding animating layout properties for effects that don't strictly require layout to change; here the actual available content width for `<main>` legitimately changes. The pragmatic, still-improved target: keep `<main>`'s `margin-left` transition (it cannot be avoided without a much larger structural rework, e.g. switching the whole layout to CSS grid with an animated grid-template-columns track, which is out of scope for this plan), but stop compounding it with `transition-all` — scope the transition to exactly `margin-left`:

```tsx
<main className={cn("flex-1 pt-14 md:pt-0 min-w-0 transition-[margin-left] duration-200", collapsed ? 'md:ml-[60px]' : 'md:ml-56')} style={{ background: '#FBF8F2' }}>
```

So the net fix in this plan is: (1) the `<aside>` itself now only ever animates `transform` (a real, full fix per §5), and (2) `<main>`'s unavoidable `margin-left` transition is at least no longer bundled under a blanket `transition-all` that could also silently animate unrelated future property changes — it's now scoped exactly to the one property that must change.

## Repo conventions to follow

- The `--ease-out`-equivalent curve `cubic-bezier(0.23,1,0.32,1)` is already used for panel/modal transforms in `components/ui.tsx:292` (`Modal`) and `:349` (`SlideOver`) — reuse the same curve for the sidebar's `transform: translateX()` transition for visual consistency, rather than Tailwind's default ease.
- `-164px` = `224px` (full `w-56` width) minus `60px` (collapsed visible width) — the exact offset needed so the remaining 60px of the 224px-wide inner `<aside>` stays visible inside the `overflow-hidden` outer shell. If `SidebarContent({ isCollapsed: true })` renders anything that depends on being left-aligned within the visible 60px (e.g. centered icons), verify visually that the correct 60px slice (the icon column, not a chopped mid-content section) remains visible after the `translateX` — check `SidebarContent`'s markup for a `w-56`/`w-[60px]` conditional inside it before assuming this offset is pixel-correct; adjust the `-164px` value if `SidebarContent`'s own icon column isn't flush-left within the 224px width.

## Steps

1. In `client/src/components/Layout.tsx`, locate the `<aside>` block (~line 748) and restructure it per Target: wrap the existing `<aside>...</aside>` in a new outer `<div>` that owns the `w-[60px]`/`w-56` sizing and `overflow-hidden`, `fixed inset-y-0 left-0 z-30`. The inner `<aside>` keeps `bg-sidebar text-sidebar-foreground flex-col shadow-xl` but drops the `hidden md:flex` (move `hidden md:block` to the new outer wrapper instead, and keep `<aside>` itself as `flex flex-col h-full w-56`).
2. Add the inline `style={{ transform: ..., transition: 'transform 200ms cubic-bezier(0.23,1,0.32,1)' }}` to the inner `<aside>` exactly as shown in Target.
3. Change `<main>`'s className (~line 817) from `transition-all duration-200` to `transition-[margin-left] duration-200` — no other change to `<main>`.
4. Re-check `SidebarContent({ isCollapsed })`'s own markup (defined earlier in this same file — search for `function SidebarContent`) for anything that already conditionally renders different content/widths based on `isCollapsed`. If it already handles a collapsed 60px layout internally (e.g. hiding labels, keeping only icons), the visible-slice math in Step 1 should line up automatically since the icon column is normally the leftmost 60px of a left-aligned sidebar. If it does NOT already left-align icons within the full 224px width (e.g. if collapsed rendering currently also changes the OUTER width via a conditional class inside `SidebarContent` itself), STOP and report — that would conflict with this plan's "inner `<aside>` is always `w-56`" assumption and needs a coordinated fix instead of a guess.

## Boundaries

- Do NOT restructure the whole app layout to CSS grid — that's a larger change than this plan covers; the `<main>` `margin-left` transition stays as a scoped, deliberate exception (documented above), not something to "fully solve" here.
- Do NOT change `SidebarContent`'s internal markup/logic as part of this plan unless Step 4 finds a genuine conflict — if so, stop and report rather than editing it speculatively.
- Do NOT change the mobile sidebar drawer (`Layout.tsx:764-776`) — that's covered by a different, separate finding (not part of this plan).
- Do NOT change the collapse-toggle button or its chevron icon (`Layout.tsx:754-760`) — already correct (`transition-transform`, not `transition-all`).

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check**:
  - Toggle sidebar collapse/expand several times on desktop width (≥768px): the sidebar should visually narrow to show only its icon column, sliding smoothly, no janky snap or content reflow flash inside the sidebar itself.
  - Confirm the collapsed sidebar still shows the correct icons/content (not a mid-cut section of the expanded layout) — this is the main visual risk called out in Steps.
  - In DevTools Performance panel, record a collapse toggle before/after: the `<aside>`'s own animation should now show as compositor-only work (no "Layout" entries attributable to the inner `<aside>`'s own size), while `<main>`'s `margin-left` change will still show a Layout entry (expected and accepted per this plan's scope).
  - Confirm no horizontal scrollbar or content clipping appears on `<main>` during the transition.
- **Done when**: `tsc`/`build` clean, the sidebar visually collapses/expands correctly via `transform` (verified in DevTools as compositor-only for the `<aside>` element specifically), and `<main>`'s transition is scoped to `margin-left` only (no more `transition-all` anywhere in this file outside what plan 002 already handles elsewhere).
