# 003 — Add `:active` press feedback to the shared `Button` primitive

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: HIGH
- **Category**: Physicality & origin (AUDIT.md §3)
- **Estimated scope**: 1 file, 1 line

## Problem

`client/src/components/ui.tsx:69-84`:
```tsx
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(({ className, variant = 'default', size = 'md', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors cursor-pointer',
      'focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
      buttonVariants[variant],
      buttonSizes[size],
      className
    )}
    {...props}
  />
))
Button.displayName = 'Button'
```
Confirmed via repo-wide grep: zero `active:` Tailwind classes exist anywhere in `client/src` (the one `active:` hit is an unrelated string literal). Every button built on this shared primitive — which is used across essentially the entire admin app — has no press feedback at all. AUDIT.md §3: "Press feedback: `transform: scale(0.97)` on `:active` with `transition: transform 160ms ease-out`. Keep it subtle (0.95–0.98)," and lists "pressable elements with no press feedback" as a specific hunt target.

## Target

```tsx
className={cn(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[color,background-color,transform] cursor-pointer active:scale-[0.97]',
  'focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100',
  buttonVariants[variant],
  buttonSizes[size],
  className
)}
```

## Repo conventions to follow

- Tailwind arbitrary-value syntax (`scale-[0.97]`) is already used elsewhere in this codebase for non-standard-scale values, e.g. `components/ui.tsx:291` (`` `scale(${entered ? 1 : 0.97})` ``, the `Modal` component) — 0.97 is the exact value this codebase already standardized on for its own scale-based motion; reuse it here rather than Tailwind's default `active:scale-95` (0.95, still within the 0.95–0.98 band per AUDIT.md but inconsistent with the value already chosen elsewhere in this file).
- `transition-[color,background-color,transform]` (an arbitrary-property list) replaces the plain `transition-colors` so the new `scale` transform also animates — Tailwind's `transition-colors` utility does not include `transform` in its property list, so leaving it as `transition-colors` would make the `active:scale-[0.97]` change apply instantly instead of easing in over ~160ms as AUDIT.md specifies. If you prefer, `transition-all` must NOT be used here (that's the exact anti-pattern plan 002 removes elsewhere) — the explicit two-property list is the correct choice.
- `disabled:active:scale-100` prevents a disabled button from visually depressing when clicked (disabled buttons already get `pointer-events-none`, so this is a defensive no-op in practice, but keep it for correctness/clarity since `disabled:opacity-50` is already handled the same defensive way one line above).

## Steps

1. In `client/src/components/ui.tsx`, inside the `Button` component's `className={cn(...)}` call (currently lines 75-80), change the first string from `'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors cursor-pointer'` to `'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[color,background-color,transform] cursor-pointer active:scale-[0.97]'`.
2. In the same `cn(...)` call, change the second string from `'focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50'` to `'focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100'`.
3. Do not add an explicit duration class — Tailwind's default transition duration (150ms) is within AUDIT.md's 100-160ms button-press-feedback budget; do not override it to something outside that range.

## Boundaries

- Do NOT touch `buttonVariants`/`buttonSizes` or any other component in this file.
- Do NOT add press feedback to `Input`/`Textarea`/`Select` or any non-button element as part of this plan — scope is the `Button` component only.
- Do NOT change any consumer of `Button` — this is a base-primitive fix, every consumer inherits it automatically.

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check**:
  - Click any `Button` anywhere in the app (e.g. Leads page's bulk-action buttons, a modal's Save button) and confirm a brief, subtle shrink-and-recover on press — not a jarring snap, and not so large it looks broken.
  - Click-and-hold, then drag the pointer off the button before releasing: confirm the scale reverts (standard `:active` browser behavior — no extra code needed for this, just confirm nothing breaks it).
  - Click a disabled button (if one is easily reachable, e.g. a form's Save button before any changes are made): confirm no press-scale plays.
  - Toggle `prefers-reduced-motion: reduce` (DevTools Rendering panel) and click a button: per AUDIT.md §6, reduced motion should keep the feedback (this is a `transform`-only press cue, not a large movement — no separate reduced-motion branch is required for this specific effect, unlike a slide/scale entrance; document in your PR/notes that this was a deliberate call and not an oversight).
- **Done when**: `tsc`/`build` are clean and a manual click on at least 3 different `Button` usages across 3 different pages shows the press feedback.
