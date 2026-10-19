# 001 — Replace hand-rolled slide-over drawers with the existing `SlideOver` component

- **Status**: TODO
- **Commit**: 52c77bf
- **Severity**: HIGH
- **Category**: Interruptibility (AUDIT.md §4) + Cohesion & tokens (§7)
- **Estimated scope**: 10 call sites across 6 files (`ContractDetail.tsx` ×5, `InvoiceDetail.tsx`, `AutomationRules.tsx`, `MovingJobDetail.tsx`, `Dashboard.tsx`, `MyDay.tsx`)

## Problem

Ten places in the app build their own "slide-over" right-hand panel by hand instead of using the app's existing `SlideOver` component (`client/src/components/ui.tsx:310-367`). Every hand-rolled instance is a bare `{condition && (<div>...</div>)}` mount. Closing the panel (calling the `onClose`/`setX(null)` handler) removes the whole subtree from the DOM in the same React commit — there is no exit transition at all, only an entrance one (`animate-in slide-in-from-right`, which itself only works because of the real `@keyframes` patched into `client/src/index.css:111-121`; the `animate-in` class name is dead weight, see Step list below).

Per AUDIT.md §4: "Anything triggered rapidly or reversible mid-motion... must use transitions or springs" — an interruptible open/close cycle needs the exit to mirror the entrance, not vanish. The app already solved this correctly next door: `SlideOver` (below) uses a `usePresence(open, exitMs)` hook that keeps the panel mounted for 220ms after `open` turns false so its CSS transition can actually play backward, fades the backdrop, and respects `prefers-reduced-motion`. Nobody outside `ui.tsx` and a couple of `Modal` usages is using it for these 10 right-hand panels.

Current code, worked example (`client/src/pages/ContractDetail.tsx:3085-3105`):

```tsx
{/* Record payment — right panel */}
{recordingPayment && (
  <div className="fixed inset-0 z-50">
    <div className="absolute inset-0 bg-black/20" onClick={() => setRecordingPayment(null)} />
    <div className="absolute right-0 top-0 h-full w-full max-w-md bg-card shadow-xl overflow-y-auto animate-in slide-in-from-right border-l">
      <div className="sticky top-0 bg-card border-b px-5 py-4 flex items-center justify-between z-10">
        <h2 className="text-base font-bold">Record payment — {(recordingPayment.invoice as any)?.invoiceNo || ''}</h2>
        <button onClick={() => setRecordingPayment(null)} className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={18} /></button>
      </div>
      <div className="p-5">
        <RecordPaymentForm
          payment={recordingPayment}
          busy={recordPayment.isPending}
          onSubmit={(body) => {
            if (!body.paidDate) { setRecordingPayment(null); return }
            recordPayment.mutate({ paymentId: recordingPayment._id, body })
          }}
        />
      </div>
    </div>
  </div>
)}
```

## Target

The existing `SlideOver` component, unchanged (do not modify `ui.tsx` in this plan):

```tsx
// client/src/components/ui.tsx:310-367 — already exists, already correct, do not edit
export function SlideOver({
  open, onClose, title, subtitle, children, width = 'max-w-2xl', side = 'right',
}: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: string; side?: 'left' | 'right' })
```

Target for the worked example above:

```tsx
{/* Record payment — right panel */}
<SlideOver
  open={!!recordingPayment}
  onClose={() => setRecordingPayment(null)}
  title={`Record payment — ${(recordingPayment?.invoice as any)?.invoiceNo || ''}`}
>
  {recordingPayment && (
    <RecordPaymentForm
      payment={recordingPayment}
      busy={recordPayment.isPending}
      onSubmit={(body) => {
        if (!body.paidDate) { setRecordingPayment(null); return }
        recordPayment.mutate({ paymentId: recordingPayment._id, body })
      }}
    />
  )}
</SlideOver>
```

Note what changed: the outer three `<div>`s (backdrop + panel + sticky header) are gone — `SlideOver` renders all of that itself, including the close `X` button. Only the `title` and the form/content move into `children`. `open` is now always evaluated (never wrapped in `{cond && ...}` at this level) so `SlideOver`'s own `usePresence` can see `open` flip to `false` and animate the exit — wrapping the whole `<SlideOver>` in `{recordingPayment && ...}` would reintroduce the exact bug this plan fixes, because the parent would unmount `SlideOver` instantly instead of letting it animate out.

## Repo conventions to follow

- `SlideOver` already exists at `client/src/components/ui.tsx:310-367` — import it in each file: `import { SlideOver } from '../components/ui'` (or `'../../components/ui'` from `pages/moving/`), adjusting for whatever else is already imported from `ui.tsx` in that file (most of these files already import `Modal` from the same place — add `SlideOver` to that existing import line rather than a new one).
- `SlideOver`'s `width` prop takes a Tailwind max-width class (default `'max-w-2xl'`). Match each panel's current width: `max-w-md`, `max-w-lg`, or `max-w-[460px]` (MyDay, see below).
- Exemplar of `SlideOver` already in correct use: none in this codebase yet outside `ui.tsx` itself — this plan introduces the first real usages. Follow the `Modal` usages already present in the same files (e.g. `ContractDetail.tsx:3107,3117,3133,3162`) for the general "pass `open`/`onClose`/`title` and put the form in `children`" shape.

## Steps

Apply this transformation at each of the 10 locations. In every case: (a) delete the outer `fixed inset-0` / backdrop / `animate-in slide-in-from-right` `<div>` wrapper and the sticky header `<div>` (title + close button), replacing them with `<SlideOver open=... onClose=... title=...>`; (b) keep the inner content untouched inside `children`; (c) make sure `open` is a plain boolean expression, never itself gated by a parent `{... &&}`.

**1. `client/src/pages/ContractDetail.tsx:3085-3105`** — "Record payment" panel. As shown in Problem/Target above. State: `recordingPayment` (object or null), setter `setRecordingPayment`.

**2. `client/src/pages/ContractDetail.tsx:3143-3160`** — "Upload document" panel. Current:
```tsx
{uploading && (
  <div className="fixed inset-0 z-50">
    <div className="absolute inset-0 bg-black/20" onClick={() => setUploading(false)} />
    <div className="absolute right-0 top-0 h-full w-full max-w-md bg-card shadow-xl overflow-y-auto animate-in slide-in-from-right border-l">
      <div className="sticky top-0 bg-card border-b px-5 py-4 flex items-center justify-between z-10">
        <h2 className="text-base font-bold">Upload document</h2>
        <button onClick={() => setUploading(false)} className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={18} /></button>
      </div>
      <div className="p-5">
        <UploadDocumentForm contractId={c._id} customerId={c.customer?._id} onDone={() => { invalidate(); setUploading(false) }} />
      </div>
    </div>
  </div>
)}
```
Target: `<SlideOver open={uploading} onClose={() => setUploading(false)} title="Upload document"><UploadDocumentForm contractId={c._id} customerId={c.customer?._id} onDone={() => { invalidate(); setUploading(false) }} /></SlideOver>`.

**3. `client/src/pages/ContractDetail.tsx:3221-3242`** — "Edit Tenant" panel. State: `editCustomerModal && c.customer`, setter `setEditCustomerModal(false)`. Title is `Edit {c.customer.fullName}` — guard the title expression since `c.customer` may be null: `title={c.customer ? \`Edit ${c.customer.fullName}\` : ''}`, and keep the `c.customer &&` guard around `<CustomerForm>` in `children` (SlideOver's `open` should be `!!(editCustomerModal && c.customer)`).

**4. `client/src/pages/ContractDetail.tsx:3245-3267`** — "Edit Contract" panel. State: `editModal`, setter `setEditModal(false)`. Title: `"Edit Contract"`.

**5. `client/src/pages/ContractDetail.tsx:3270-3273` onward (panel closes further down — read the full block before editing)** — "Notice" panel. State: `noticeOpen` (object with `.name`), setter `setNoticeOpen(null)`. This one has a `subtitle` under the title already (`Prefilled for {c.customer?.fullName || 'the tenant'} — edit freely, then send.`) — use `SlideOver`'s `subtitle` prop for it instead of the current manual `<p>` under the `<h2>`. Title: `` `${noticeOpen?.name} — ${c.contractNo}` ``. This panel also uses `flex flex-col` on the outer content div (for a sticky footer below the editable body) — check whether `SlideOver`'s own `children` wrapper (`<div className="p-5 flex-1">`) needs the content to additionally be wrapped in `className="flex flex-col h-full"` internally to preserve the existing scroll/footer layout; if the footer (send button row) was relying on the outer panel being `flex flex-col`, keep that structure one level deeper, inside `children`.

**6. `client/src/pages/InvoiceDetail.tsx:401-408`** — inside `function EditInvoiceModal({ invoice, onClose, onSaved })` (defined at line 333). **Gotcha**: this component is rendered by its parent as `{editing && (<EditInvoiceModal invoice={invoice} onClose={() => setEditing(false)} onSaved={...} />)}` at line 1051-1059. If you only fix the inside of `EditInvoiceModal`, the parent's `{editing && ...}` still unmounts the whole component instantly and `SlideOver` never gets to see `open` go from `true` to `false`. Fix both ends:
   - At the parent call site (~line 1050-1060), change `{editing && (<EditInvoiceModal .../>)}` to always render: `<EditInvoiceModal open={editing} invoice={invoice} onClose={() => setEditing(false)} onSaved={...} />` (drop the `{editing && }` wrapper; `invoice` must already be non-null whenever this renders — check the surrounding code for an existing `invoice &&` guard higher up and keep that one, just remove the `editing &&` specifically).
   - Inside `EditInvoiceModal` itself, add an `open: boolean` prop, replace the outer three `<div>`s with `<SlideOver open={open} onClose={onClose} title={\`Edit ${docLabel(invoice)} ${invoice.invoiceNo}\`} width="max-w-lg">`, and move the existing form content into `children`.

**7. `client/src/pages/AutomationRules.tsx:939` (`function StepTemplateModal({ step, templates, onSave, onClose })`), body at lines 967-975+** — same gotcha as #6. Parent call site is lines 484-498: `{editingTemplate && (() => { ...; return <StepTemplateModal step={step} templates={templates} onSave={...} onClose={() => setEditingTemplate(null)} /> })()}`. This one is an IIFE returning `null` when `rule`/`step` aren't found — keep that early-return guard (it's a data-lookup guard, not the open/close state), but stop gating the whole thing on `editingTemplate` truthiness for mounting purposes: restructure so the IIFE always runs when the component is rendered, and pass `open={!!editingTemplate}` into `StepTemplateModal`. Concretely: keep `editingTemplate` in the JSX unconditionally (remove the `editingTemplate &&` at the top), and inside the IIFE, if `!editingTemplate || !rule || !step`, return `<StepTemplateModal open={false} .../>` with placeholder/last-known values, OR — simpler and safer — give `StepTemplateModal` an internal `usePresence`-friendly guard by instead keeping `rule`/`step` resolution inside `StepTemplateModal` itself (pass `editingTemplate` and the full `rules`/`templates` arrays down, let it resolve `rule`/`step` internally, return `null` from within `SlideOver`'s `children` when not found, never from the top of the component). Pick whichever keeps `StepTemplateModal` always mounted with a stable `open` boolean prop — the goal is that `open` toggling to `false` reaches `SlideOver` without an intermediate `{... && ...}` unmount. If the data-lookup restructuring isn't safely achievable within this component's current shape, STOP and report back rather than improvising a riskier refactor.

**8. `client/src/pages/moving/MovingJobDetail.tsx:427-450ish` ("Notice slide-over: edit, then send — same pattern as the storage side")** — local state `open`/`setOpen(null)`, same shape as ContractDetail's notice panel (#5): has a subtitle line too (`Prefilled for {job.customer?.fullName || 'the customer'} — edit freely, then send.`). Apply the same transformation as #5, using `SlideOver`'s `subtitle` prop, width `max-w-2xl`.

**9. `client/src/pages/Dashboard.tsx:677-685+` (read the full block before editing — it continues past line 689)** — "Move-ins/outs/Available units" detail panel. State: `movePanel` (`'in' | 'out' | 'available' | null`) plus a `stats` guard, setter `setMovePanel(null)`. Title is a ternary already — keep that expression, just move it into `SlideOver`'s `title` prop. `open={!!(movePanel && stats)}`.

**10. `client/src/pages/MyDay.tsx:671-696`** — the chat slide-over. This one uses inline styles, not Tailwind classes, and a custom `pbSlide` keyframe (`client/src/pages/MyDay.tsx:225`, `@keyframes pbSlide { from { transform:translateX(24px); opacity:0 } to { transform:translateX(0); opacity:1 } }`) instead of the app's shared `.slide-in-from-right`. Replace the whole block with `SlideOver`:
```tsx
<SlideOver open={!!chatPhone} onClose={() => setChatPhone(null)} title="Conversation" width="max-w-[460px]">
  <div style={{ margin: '-20px', height: 'calc(100% + 40px)' }}>
    <WhatsApp embeddedPhone={chatPhone ?? ''} />
  </div>
</SlideOver>
```
(The `margin: -20px` / `height: calc(100% + 40px)` compensates for `SlideOver`'s own `<div className="p-5 flex-1">` content padding, since the embedded `<WhatsApp>` console is meant to fill the panel edge-to-edge, not sit inset. Verify this visually in Step's feel-check — if the negative margin causes a visible seam or scrollbar, use `SlideOver`'s raw structure as reference and instead adjust by rendering `WhatsApp` in a wrapper with `position: absolute; inset: 0` relative to `SlideOver`'s panel — but do not modify `SlideOver` itself to add a "no-padding" variant as part of this plan; if neither inline fix looks right, STOP and report back rather than modifying the shared component.)
Also delete the now-unused `pbSlide` `@keyframes` block at `MyDay.tsx:225` once nothing references it (confirm with a repo-wide grep for `pbSlide` first — do not delete if anything else still uses it).

**11. Dead class cleanup** — after steps 1-10, grep the whole `client/src` for `animate-in slide-in-from` (should now match 0 results if all 10 are converted — the class was always inert, since `tailwindcss-animate` was never installed; see `client/src/index.css:111-114`'s own comment). If any remain (a location this plan's audit missed), remove just the dead `animate-in` token from that `className`, leaving `.slide-in-from-right`/`.slide-in-from-left` in place (those two classes are real, defined in `index.css:115-121`) — do not touch `index.css`.

## Boundaries

- Do NOT modify `client/src/components/ui.tsx` — `SlideOver`/`Modal`/`usePresence` are already correct; this plan only changes call sites.
- Do NOT change `client/src/index.css`'s `.slide-in-from-right`/`.slide-in-from-left`/`pb-slide-in-right`/`pb-slide-in-left` — they stay as-is for any other consumer.
- Do NOT change the underlying form components (`RecordPaymentForm`, `UploadDocumentForm`, `CustomerForm`, `EditContractForm`, notice-editor markup, `WhatsApp`, etc.) — only the panel chrome wrapping them.
- Do NOT add a global keyboard-Escape-to-close or focus-trap behavior as part of this plan even if you notice it's missing — that's a separate, unrelated feature, out of scope here.
- If a step's current code doesn't match what's quoted here (drift since commit `52c77bf`), STOP on that specific location and report instead of improvising — apply the other 9 and flag the mismatched one.

## Verification

- **Mechanical**: `cd client && npx tsc --noEmit` — must be clean (or match the pre-existing baseline errors only, if any exist; check `git stash` + a baseline run first if unsure). Also `cd client && npm run build` to confirm no bundler errors from the new `SlideOver` imports.
- **Feel check** (repeat for at least 3 of the 10 — the ContractDetail "Record payment" panel, the MyDay chat panel, and the InvoiceDetail one with the parent-conditional gotcha):
  - Open the panel: it should slide in from the right over ~220ms with the backdrop fading in alongside it (not popping to full opacity instantly).
  - Close it: it should now visibly slide back out and the backdrop should fade out — compare against the current instant-vanish behavior on `main` before this change.
  - Open, then immediately click the backdrop to close, then immediately reopen (rapid open-close-open): confirm no visual glitch, stuck backdrop, or double-panel.
  - In Chrome DevTools' Rendering panel, force `prefers-reduced-motion: reduce` and confirm the panel still fades but no longer slides (per `SlideOver`'s existing `reduced` branch), for at least one of the three checked panels.
  - For the InvoiceDetail and AutomationRules cases specifically: confirm the exit animation actually plays (this is the one most likely to still be broken if the parent-conditional gotcha wasn't fully fixed — if the panel still vanishes instantly, the parent is still unmounting it early).
- **Done when**: all 10 locations use `<SlideOver>`, `npx tsc --noEmit` is clean, a manual close on each of the 3 feel-checked panels visibly animates out (not an instant unmount), and a repo-wide grep for `animate-in slide-in-from` in `client/src` returns zero results.
