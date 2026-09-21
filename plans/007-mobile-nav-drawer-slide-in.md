# 007 — Apply the existing slide-in convention to the mobile nav drawer

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens (AUDIT.md §7) + Missed opportunities (§8)
- **Estimated scope**: 1 file (`Layout.tsx`)

## Problem

`client/src/components/Layout.tsx:764-776`:
```tsx
{sidebarOpen && (
  <div className="md:hidden fixed inset-0 z-40 flex">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
    <aside className="relative w-64 max-w-[80vw] bg-sidebar text-sidebar-foreground flex flex-col h-full shadow-2xl">
      {SidebarContent()}
    </aside>
  </div>
)}
```
Mounts with zero animation — no fade on the backdrop, no slide on the panel — while the exact same "edge-anchored overlay panel" pattern already has a real, working convention used elsewhere in the app: `.slide-in-from-left`/`pb-slide-in-left` (`client/src/index.css:111-121`, `.22s cubic-bezier(.2,.8,.3,1)`, already correctly reduced-motion-gated). The one place that most resembles those panels — the global mobile nav drawer — is the one place not using it.

## Target

```tsx
{sidebarOpen && (
  <div className="md:hidden fixed inset-0 z-40 flex">
    <div
      className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      style={{ animation: 'pb-slide-fade-in .22s cubic-bezier(.2,.8,.3,1)' }}
      onClick={() => setSidebarOpen(false)}
    />
    <aside className="relative w-64 max-w-[80vw] bg-sidebar text-sidebar-foreground flex flex-col h-full shadow-2xl slide-in-from-left">
      {SidebarContent()}
    </aside>
  </div>
)}
```
This needs one new, small keyframe for the backdrop fade (a slide-in panel's backdrop should fade, not slide) — add it next to the existing two in `index.css`:
```css
/* client/src/index.css — add directly after the existing .slide-in-from-left rule, ~line 121 */
@keyframes pb-slide-fade-in { from { opacity: 0; } to { opacity: 1; } }
```
and extend the existing reduced-motion guard (`index.css:119-121`) to cover it too.

## Repo conventions to follow

- `.slide-in-from-left` (panel) already exists and is correctly reduced-motion-gated — apply it to the `<aside>` unchanged, do not redefine it.
- The new `pb-slide-fade-in` keyframe follows the exact naming convention of the existing `pb-slide-in-right`/`pb-slide-in-left` (prefix `pb-`, kebab-case, descriptive suffix).

## Steps

1. In `client/src/index.css`, immediately after the existing block (currently lines 111-121: the two `@keyframes` + two `.slide-in-from-*` classes + their reduced-motion guard), add the new `pb-slide-fade-in` keyframe from Target.
2. Extend the existing `@media (prefers-reduced-motion: reduce) { .slide-in-from-right, .slide-in-from-left { animation: none; } }` block (line 119-121) to also list a new class, `.slide-fade-in { animation: none; }`, and define `.slide-fade-in { animation: pb-slide-fade-in .22s cubic-bezier(.2,.8,.3,1); }` as a real class (not just inline style) so it can be reduced-motion-gated the same way as its siblings — i.e., do NOT use an inline `style={{ animation: ... }}` on the backdrop as shown in the first Target snippet (inline styles bypass the CSS media-query guard, which is exactly finding #1/HIGH from plan 001's sibling audit — MyDay.tsx's `pbSlide` inline animation had this same bug). Use a class instead: `className="absolute inset-0 bg-black/60 backdrop-blur-sm slide-fade-in"`.
3. In `client/src/components/Layout.tsx`, apply `slide-fade-in` to the backdrop `<div>` (line ~768) and `slide-in-from-left` to the `<aside>` (line ~772), per the corrected (class-based, not inline-style) version of Target.

## Boundaries

- Do NOT modify `.slide-in-from-right`/`pb-slide-in-right` (unused by this plan) or any other existing rule in `index.css`.
- Do NOT change `SidebarContent()` or any content inside the drawer.
- Do NOT use inline `style={{ animation: ... }}` for the backdrop — must be a real CSS class so the reduced-motion media query applies (see Step 2's explicit warning).

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check**: On a narrow viewport (or DevTools device toolbar), open the mobile nav (hamburger icon): backdrop should fade in, panel should slide in from the left, both over ~220ms. Toggle `prefers-reduced-motion: reduce` and reopen: confirm both effects are disabled (panel and backdrop appear instantly, no motion).
- **Done when**: `tsc`/`build` clean, the drawer opens with fade+slide on a mobile viewport, and reduced-motion correctly disables both.
