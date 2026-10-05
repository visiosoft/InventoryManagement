# 012 — Small accessibility/easing fixes: footer pulse, lead-alert reduced-motion, send-button press depth

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: LOW
- **Category**: Accessibility (AUDIT.md §6) + Easing & duration (§2) + Physicality (§3)
- **Estimated scope**: 3 files, 3 one-line fixes

## Problem

**(a) `client/src/components/AppFooter.tsx:121,153`** — infinite pulse uses `ease-out`, and has no reduced-motion gate:
```tsx
<span style={{ width: 7, height: 7, borderRadius: 999, background: status.dot, display: 'inline-block', animation: status.dot === OK_DOT ? 'pb-footer-pulse 2.4s ease-out infinite' : undefined }} />
...
<style>{`@keyframes pb-footer-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 100% { box-shadow: 0 0 0 6px rgba(34,197,94,0); } }`}</style>
```
AUDIT.md §2: "Constant motion (marquee, progress) → `linear`" — `ease-out` on an infinite loop decelerates into a hard cut back to start every 2.4s, a visible stutter. §6: no reduced-motion handling at all on a permanently-running animation.

**(b) `client/src/components/LeadAlerts.tsx:269-271`** — reduced-motion override nukes the fade too, not just movement:
```css
@media (prefers-reduced-motion: reduce) {
  @keyframes pb-lead-alert-in { from { opacity: 1; } to { opacity: 1; } }
}
```
AUDIT.md §6: "fewer and gentler... not zero — keep transitions that aid comprehension, remove position changes," and separately: "reduced-motion implementations that nuke all feedback" is a named hunt target. Both keyframe stops being `opacity: 1` means there IS no fade for reduced-motion users — worse than intended.

**(c) `client/src/pages/WhatsApp.tsx:4733`** — Send button press feedback too aggressive for a 100+/day action:
```tsx
className="... active:scale-90 transition-transform duration-100 disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100"
```
AUDIT.md §3: press feedback should be "subtle (0.95–0.98)" — `scale-90` (0.90) is outside that band.

## Target

```tsx
/* (a) AppFooter.tsx:121 */
animation: status.dot === OK_DOT ? 'pb-footer-pulse 2.4s linear infinite' : undefined
```
```css
/* (a) AppFooter.tsx:153 — add a reduced-motion guard next to the keyframe */
@media (prefers-reduced-motion: reduce) {
  .pb-footer-dot { animation: none !important; }
}
```
(This requires giving the `<span>` a class to target, since it currently has no class — see Steps.)

```css
/* (b) LeadAlerts.tsx:269-271 */
@media (prefers-reduced-motion: reduce) {
  @keyframes pb-lead-alert-in { from { opacity: 0; } to { opacity: 1; } }
}
```

```tsx
/* (c) WhatsApp.tsx:4733 */
className="... active:scale-95 transition-transform duration-100 disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100"
```

## Repo conventions to follow

- `SalesBoard.tsx:794-796`'s `.lead-new` reduced-motion override is the correct exemplar for "keep something, drop the loop" — not directly reused here since AppFooter's dot is a status pulse rather than an attention-getter, but the same principle (add a real, present guard rather than skip it) applies.
- `0.95` matches this codebase's Tailwind default `active:scale-95` utility, already the right choice here (unlike plan 003's `Button` primitive, which deliberately uses the custom `0.97` value already established elsewhere — this Send button can use the plain Tailwind default since there's no pre-existing `0.97`-style convention specific to it).

## Steps

1. In `client/src/components/AppFooter.tsx`, change line 121's `'pb-footer-pulse 2.4s ease-out infinite'` to `'pb-footer-pulse 2.4s linear infinite'`.
2. Give the pulsing `<span>` (line 121) a class, e.g. `className="pb-footer-dot"`, alongside its existing inline `style` (inline styles and a class can coexist on the same element).
3. In the `<style>` block at line 153, add: `@media (prefers-reduced-motion: reduce) { .pb-footer-dot { animation: none !important; } }` (the `!important` is needed here because the animation is otherwise set via inline `style`, which normally beats a stylesheet rule — same reasoning as plan 007's Step 2 warning about inline animations bypassing media queries, but here we can't easily switch the whole animation to a class-only approach without a larger refactor of the conditional `status.dot === OK_DOT` check, so `!important` is the pragmatic, scoped fix).
4. In `client/src/components/LeadAlerts.tsx:269-271`, change the reduced-motion keyframe override's `from`/`to` values from both being `opacity: 1` to `from { opacity: 0; }` / `to { opacity: 1; }` — this keeps the fade, drops nothing else (there was no transform in the entrance keyframe to begin with, so this alone brings it in line with AUDIT.md §6's "not zero" rule). Coordinate with plan 010 if applied after it — plan 010 adds a matching `pb-lead-alert-out` keyframe and this same reduced-motion block should be extended to cover it too (`pb-lead-alert-out { from { opacity: 1; } to { opacity: 1; } }` — i.e., keep it visible instantly-ish rather than sliding, consistent with this plan's principle).
5. In `client/src/pages/WhatsApp.tsx:4733`, change `active:scale-90` to `active:scale-95`.

## Boundaries

- Do NOT change the 2.4s pulse duration, the lead-alert entrance duration, or the Send button's `duration-100` — only the specific values called out above.
- Do NOT touch any other `active:scale-*` usage in `WhatsApp.tsx` or elsewhere as part of this plan.

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check**:
  - AppFooter's health dot: pulse should look smoother/more even (linear) rather than stutter-stepping at the loop boundary. Toggle reduced-motion and confirm the pulse stops entirely.
  - Trigger a lead alert with reduced-motion on: confirm it now visibly fades in (not an instant full-opacity pop).
  - Press the WhatsApp Send button: confirm a more subtle press depression than before.
- **Done when**: all three one-line changes are applied, `tsc`/`build` clean.
