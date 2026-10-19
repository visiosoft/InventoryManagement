# 011 — Fade + scale the photo lightbox in from its thumbnail instead of teleporting

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: MEDIUM
- **Category**: Missed opportunities (AUDIT.md §8)
- **Estimated scope**: 2 files (`SharedJobView.tsx`, `MovingJobDetail.tsx`)

## Problem

`client/src/pages/moving/SharedJobView.tsx:175-189` (customer-facing — this link is sent directly to clients/movers):
```tsx
{lightbox !== null && (
  <div onClick={() => setLightbox(null)}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'grid', placeItems: 'center', padding: 16 }}>
    <img src={job.images[lightbox].url} ... />
  </div>
)}
```
`client/src/pages/moving/MovingJobDetail.tsx:1540-1552` (internal admin use, same pattern):
```tsx
{lightboxImg && (
  <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
    ...
  </div>
)}
```
Tapping a thumbnail teleports straight to a full-screen dark overlay with the image at full size; closing is an equally instant unmount. AUDIT.md §8: spatially-connected UI (an image expanding from its grid trigger) with no motion explaining where it came from. AUDIT.md §3: never `scale(0)` — target `scale(0.9-0.97)` + opacity.

## Target

Apply the same `usePresence`-based fade+scale pattern as `ui.tsx`'s `Modal` (this plan does NOT need `Modal` itself — the lightbox has different layout needs — but copies its technique):
```tsx
// target — SharedJobView.tsx, replace the block at lines 175-189
{lightbox !== null && (() => {
  // local presence tracking since this file doesn't already import ui.tsx's usePresence
  return (
    <div
      onClick={() => setLightbox(null)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: 'grid', placeItems: 'center', padding: 16,
        background: 'rgba(0,0,0,0.9)',
        opacity: lightboxEntered ? 1 : 0,
        transition: 'opacity 200ms cubic-bezier(0.23,1,0.32,1)',
      }}
    >
      <img
        src={job.images[lightbox].url}
        style={{
          transform: `scale(${lightboxEntered ? 1 : 0.95})`,
          transition: 'transform 200ms cubic-bezier(0.23,1,0.32,1)',
          maxWidth: '100%', maxHeight: '100%',
        }}
        {...existingImgProps}
      />
    </div>
  )
})()}
```
where `lightboxEntered` is a new small piece of state, set `true` one frame after `lightbox` becomes non-null (the same "enter on next frame" technique `ui.tsx`'s `usePresence` uses internally):
```tsx
const [lightboxEntered, setLightboxEntered] = useState(false)
useEffect(() => {
  if (lightbox === null) { setLightboxEntered(false); return }
  const raf = requestAnimationFrame(() => setLightboxEntered(true))
  return () => cancelAnimationFrame(raf)
}, [lightbox])
```
This plan does not attempt a full presence-aware EXIT animation (that would need the same `usePresence` delayed-unmount machinery as plan 001/006) — scope here is just the entrance, since these two lightboxes are simple, low-frequency, single-purpose overlays where an instant close is a smaller miss than an instant open (per AUDIT.md's "first impression" framing, the opening moment is the one that most needs to explain where the content came from). If a future pass wants a symmetric exit too, that's a natural follow-up, not required here.

## Repo conventions to follow

- `scale(0.95)`+opacity is within AUDIT.md §3's `scale(0.9-0.97)` recommended range and close to `ui.tsx`'s own `Modal` value (`0.97`) — using `0.95` here (rather than copying `0.97` exactly) is fine since this is a full-screen image reveal, a slightly larger scale delta than a small modal reads better; do not go below `0.9`.
- `cubic-bezier(0.23,1,0.32,1)` is the app's established entrance curve (`ui.tsx:292`) — reuse it exactly rather than a bare `ease`.

## Steps

1. In `client/src/pages/moving/SharedJobView.tsx`, add the `lightboxEntered` state and `useEffect` per Target near wherever `lightbox` state is already declared.
2. Replace the block at lines 175-189 with the animated version per Target, preserving the existing `<img>`'s other props (alt text, etc. — read the current full block before replacing to avoid dropping any existing attribute).
3. Repeat steps 1-2 in `client/src/pages/moving/MovingJobDetail.tsx` for `lightboxImg`/`setLightboxImg` (lines 1540-1552), adapting variable names (`lightboxImgEntered` or similar) and preserving its existing Tailwind classes (`fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4`) alongside the new inline `opacity`/`transition` styles.

## Boundaries

- Do NOT build a shared/reusable `Lightbox` component as part of this plan — fix both call sites independently, matching each file's existing style (inline styles for `SharedJobView.tsx`, Tailwind classes for `MovingJobDetail.tsx`).
- Do NOT add an exit animation in this pass (see Problem/Target's scope note) — closing remains an instant unmount, which is acceptable for this plan.
- Do NOT change what closes the lightbox (still click-anywhere via the existing `onClick`).

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` clean; `npm run build` succeeds.
- **Feel check** (both files): tap/click a thumbnail — the full-screen overlay should fade in and the image should grow in from ~95% scale, not pop instantly to full size.
- **Done when**: both lightboxes show the entrance animation, `tsc`/`build` clean.
