# 002 — Replace `transition: all` with property-specific transitions (nav + FloorMap)

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: HIGH
- **Category**: Performance (AUDIT.md §5)
- **Estimated scope**: 2 files (`Layout.tsx` ~15 occurrences, `FloorMap.tsx` 1 occurrence)

## Problem

AUDIT.md §5 is explicit: "`transition: all` animates unintended properties off-GPU — always a finding." Two places use it:

`client/src/pages/FloorMap.tsx:724-728` (confirmed the only `transition: all`/`transition-all` in this file):
```tsx
const pill = (active: boolean) => ({
  height: 30, padding: '0 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 600, transition: 'all .15s',
  background: active ? PURPLE : 'transparent', color: active ? '#fff' : '#4A1FA0',
} as React.CSSProperties)
```
Only `background`/`color` ever change on this pill (used for the "Availability/Edit layout" mode toggle and floor tabs, lines ~854/874) — no transform, no layout property is intentionally animated here.

`client/src/components/Layout.tsx` — 17 occurrences of `transition-all` (confirmed via `grep -n "transition-all" client/src/components/Layout.tsx`), the two structurally significant ones plus representative nav-link ones:
```tsx
// Layout.tsx:748 — desktop sidebar
<aside className={cn("hidden md:flex fixed inset-y-0 left-0 bg-sidebar text-sidebar-foreground flex-col z-30 shadow-xl transition-all duration-200", collapsed ? 'w-[60px]' : 'w-56')}>

// Layout.tsx:817 — main content offset
<main className={cn("flex-1 pt-14 md:pt-0 min-w-0 transition-all duration-200", collapsed ? 'md:ml-[60px]' : 'md:ml-56')} style={{ background: '#FBF8F2' }}>

// Layout.tsx:759 — collapse-toggle chevron (this one is fine — see Boundaries)
<ChevronDown size={16} className={cn('transition-transform duration-200', collapsed ? '-rotate-90' : 'rotate-90')} />
```
The `w-[60px]`/`w-56` and `md:ml-[60px]`/`md:ml-56` ones (lines 748, 817) are handled separately in plan 004 (they need a structural fix, not just a class swap, because `width`/`margin-left` are the actual properties being animated). **This plan (002) covers every OTHER `transition-all` in `Layout.tsx`** — the nav links, pills, and toggle buttons where only `background-color`/`color` change and a simple class swap is sufficient. Representative examples (exact lines from the file as of commit `52c77bf` — re-grep `transition-all` in this file before editing, since line numbers shift as you edit top to bottom):
```tsx
// e.g. a sidebar nav link
className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150', ...)}
```
Every one of these only changes `background-color`/`color`/`opacity` on hover or active state — confirmed by reading the full className strings at each site; none of them have an accompanying `transform`, `width`, or other layout property tied to the same hover/active toggle.

This is the app's global navigation, rendered on every page for every user — AUDIT.md §1's frequency table puts hover states at "tens of times/day → remove or drastically reduce," and a blanket `all` here also silently animates any future style addition (e.g. a later `box-shadow` tweak) with no intent behind it.

## Target

```css
/* FloorMap.tsx pill() — target */
transition: 'background-color .15s, color .15s',
```

```tsx
/* Layout.tsx nav links/pills — target, one example */
className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150', ...)}
```

## Repo conventions to follow

- `transition-colors` is already used correctly elsewhere in the very same file for the identical hover pattern — e.g. `Layout.tsx:756` (`"shrink-0 flex items-center justify-center h-10 border-t border-white/10 text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5 cursor-pointer transition-colors"`, no duration suffix needed — Tailwind's default `transition-colors` duration is 150ms, matching the budget) and `Layout.tsx:782/795/803` (mobile header icon buttons). Match that exact class name, dropping the explicit `duration-150`/`duration-200` suffix only if the site you're editing doesn't otherwise need a non-default duration — if unsure, keep whatever duration suffix was already there (just change `-all` to `-colors`).

## Steps

1. In `client/src/pages/FloorMap.tsx`, change line 726 from `fontSize: 13, fontWeight: 600, transition: 'all .15s',` to `fontSize: 13, fontWeight: 600, transition: 'background-color .15s, color .15s',`.
2. In `client/src/components/Layout.tsx`, run `grep -n "transition-all" client/src/components/Layout.tsx` fresh (line numbers below are from commit `52c77bf` and may have shifted if plan 004 was applied first — coordinate with plan 004's author/run order, see Boundaries).
3. For every `transition-all` occurrence found EXCEPT the two on the `<aside>` (sidebar, ~line 748) and `<main>` (~line 817) elements, replace `transition-all` with `transition-colors` in the className string. Before changing each one, confirm by reading the full className that no `transform`/`width`/`height`/`margin`/`padding`/`top`/`left`/`opacity`-on-a-layout-affecting-context is toggled alongside the color change at that same site — if you find one that also toggles something beyond color (e.g. a badge that also scales), STOP on that specific occurrence and report it instead of guessing; apply the fix to every other confirmed-color-only occurrence.
4. Skip the `<aside>` (~748) and `<main>` (~817) occurrences entirely — those are fixed by plan 004, not this one. Do not touch them here even though they also contain `transition-all`.

## Boundaries

- Do NOT touch `Layout.tsx:748` (`<aside>`) or `Layout.tsx:817` (`<main>`) — reserved for plan 004's structural fix. If plan 004 has already run and those two are already fixed (no longer say `transition-all`), simply skip them (they won't match anyway).
- Do NOT change any duration values, only the property list (`all` → `colors`, or the explicit `background-color .15s, color .15s` form for the one inline-style case).
- Do NOT touch `FloorMap.tsx:745`'s `transition: 'opacity .15s'` — that one is already correct (opacity-only).

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check**:
  - Hover every sidebar nav link and the FloorMap mode/floor pills — color should still transition smoothly (~150ms), no visual regression versus before.
  - In DevTools' Performance panel, record a hover sweep across several sidebar links before/after — confirm the "Recalculate Style"/"Layout" entries per hover drop out (only "Composite"/paint-adjacent work should remain for a pure color transition).
- **Done when**: a repo-wide grep for `transition-all` in `client/src/components/Layout.tsx` returns only the two lines reserved for plan 004, `FloorMap.tsx` has zero `transition: 'all` occurrences, and `tsc`/`build` are clean.
