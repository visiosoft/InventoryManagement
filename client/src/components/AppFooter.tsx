import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Coffee, Heart, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { BUILD } from '../version'

const INK = '#1A0B33'
const HAIRLINE = 'rgba(255,255,255,.14)'
const FAINT_TEXT = 'rgba(255,255,255,.62)'
const DIM_TEXT = 'rgba(255,255,255,.45)'
const CHIP_BG = 'rgba(255,255,255,.08)'
const CHIP_HOVER = 'rgba(255,255,255,.16)'
const ACCENT = '#A78BFA'
const OK_DOT = '#22c55e'
const OK_TEXT = '#86efac'
const WARN_DOT = '#FBBF24'
const WARN_TEXT = '#FDE68A'
const UNSURE_DOT = 'rgba(255,255,255,.4)'

type Stamp = {
  sha: string; short: string; committedAt?: string; message?: string; builtAt?: string; startedAt?: string
  /* From the API: is its server code the server code at this page's commit?
     The API only redeploys when server/ changes, so a client-only push
     leaves it on an older commit on purpose — that is not "behind". */
  serverInSync?: boolean | null
}

/**
 * The footer: who built it, and whether what you are looking at is live.
 *
 * Three commits are compared. The one baked into this page, the newest one
 * Netlify has published, and the one the API is running. When the three
 * agree, a push is fully live. When the page is behind, it says so and
 * offers a reload; when the API is behind, it says that instead — which is
 * the answer to "I pushed, is it up yet?" without opening two dashboards.
 */
export default function AppFooter() {
  const [open, setOpen] = useState(false)

  // What is published now — served beside the bundle, so it moves the moment
  // a deploy lands, even while this page still carries the old build.
  const { data: latest } = useQuery<Stamp>({
    queryKey: ['version', 'client'],
    queryFn: () => fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()),
    refetchInterval: 2 * 60_000,
    retry: false,
  })
  const { data: apiVersion } = useQuery<Stamp>({
    queryKey: ['version', 'api'],
    queryFn: () => api.get('/version', { params: { client: BUILD.sha } }).then((r) => r.data),
    refetchInterval: 2 * 60_000,
    retry: false,
  })

  const pageBehind = Boolean(latest?.sha && latest.sha !== 'unknown' && BUILD.sha !== 'unknown' && latest.sha !== BUILD.sha)
  const apiKnown = Boolean(apiVersion?.sha && apiVersion.sha !== 'unknown')
  // The API's own answer wins; raw commit equality is the fallback when it
  // could not compare (a commit it has not fetched yet).
  const apiInSync = apiKnown && (apiVersion!.serverInSync === true || (apiVersion!.serverInSync == null && apiVersion!.sha === BUILD.sha))
  const apiBehind = apiKnown && apiVersion!.serverInSync === false
  const apiUnsure = apiKnown && !apiInSync && !apiBehind

  const ago = (iso?: string) => {
    if (!iso) return ''
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const h = Math.round(mins / 60)
    if (h < 48) return `${h} h ago`
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  const status = pageBehind
    ? { dot: WARN_DOT, text: 'A newer version is live', tone: WARN_TEXT }
    : apiBehind
      ? { dot: WARN_DOT, text: `API not yet updated (on ${apiVersion!.short})`, tone: WARN_TEXT }
      : apiInSync
        ? { dot: OK_DOT, text: 'Live and in sync', tone: OK_TEXT }
        : apiUnsure
          ? { dot: UNSURE_DOT, text: `API on ${apiVersion!.short}`, tone: FAINT_TEXT }
          : { dot: UNSURE_DOT, text: 'Checking…', tone: FAINT_TEXT }

  return (
    <footer style={{ background: INK, marginTop: 24 }}>
      <div
        className="flex flex-wrap items-center justify-between gap-4 px-5 sm:px-7"
        style={{ padding: '18px 20px' }}
      >
        <div className="flex flex-wrap items-center gap-3.5">
          <span style={{ fontFamily: "'Bricolage Grotesque', serif", fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', color: '#fff' }}>
            Zulfiqar
          </span>
          <span aria-hidden="true" style={{ width: 1, height: 16, background: HAIRLINE }} />
          <span className="inline-flex items-center gap-1.5" style={{ fontSize: 13, color: FAINT_TEXT }}>
            <span>Built with</span>
            <Coffee size={14} aria-label="coffee" />
            <span>and</span>
            <Heart size={14} aria-label="love" fill={ACCENT} stroke={ACCENT} />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3.5">
          {pageBehind && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 cursor-pointer"
              style={{ background: ACCENT, color: INK, border: 0, borderRadius: 999, padding: '6px 12px', fontSize: 12.5, fontWeight: 700 }}
            >
              <RefreshCw size={12} /> Reload for {latest!.short}
            </button>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-2 cursor-pointer"
            style={{ background: 'none', border: 0, padding: 0, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: status.tone }}
            title={BUILD.message ? `${BUILD.short} — ${BUILD.message}` : BUILD.short}
          >
            <span style={{ width: 7, height: 7, borderRadius: 999, background: status.dot, display: 'inline-block', animation: status.dot === OK_DOT ? 'pb-footer-pulse 2.4s ease-out infinite' : undefined }} />
            {status.text}
          </button>

          <span
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
              fontSize: 12.5, color: '#DDD0FF', background: CHIP_BG, padding: '6px 11px', borderRadius: 8,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = CHIP_HOVER }}
            onMouseLeave={(e) => { e.currentTarget.style.background = CHIP_BG }}
          >
            {BUILD.short}
          </span>

          <span style={{ fontSize: 13, color: DIM_TEXT, fontVariantNumeric: 'tabular-nums' }}>
            {BUILD.committedAt ? `pushed ${ago(BUILD.committedAt)}` : ''}
          </span>
        </div>
      </div>

      {open && (
        <div
          className="px-5 sm:px-7"
          style={{ borderTop: `1px solid ${HAIRLINE}`, padding: '12px 20px', color: FAINT_TEXT, fontSize: 11.5, lineHeight: 1.7, fontVariantNumeric: 'tabular-nums' }}
        >
          <div><b style={{ color: '#fff' }}>This page</b> · {BUILD.short} · {BUILD.message || ''} · built {ago(BUILD.builtAt)}</div>
          <div><b style={{ color: '#fff' }}>Published</b> · {latest?.short || '—'} {latest?.message ? `· ${latest.message}` : ''} {latest?.builtAt ? `· built ${ago(latest.builtAt)}` : ''}</div>
          <div><b style={{ color: '#fff' }}>API</b> · {apiVersion?.short || 'unreachable'} {apiVersion?.message ? `· ${apiVersion.message}` : ''} {apiVersion?.startedAt ? `· started ${ago(apiVersion.startedAt)}` : ''}</div>
        </div>
      )}

      <style>{`@keyframes pb-footer-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 100% { box-shadow: 0 0 0 6px rgba(34,197,94,0); } }`}</style>
    </footer>
  )
}
