import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Coffee, Heart, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { BUILD } from '../version'

const FAINT = '#756E80'
const MUTED = '#4A4357'
const PURPLE_INK = '#4A1FA0'
const LINE = 'rgba(20,8,31,.10)'
const OK = '#0F6E56'
const WARN = '#8A5A00'

type Stamp = { sha: string; short: string; committedAt?: string; message?: string; builtAt?: string; startedAt?: string }

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
    queryFn: () => api.get('/version').then((r) => r.data),
    refetchInterval: 2 * 60_000,
    retry: false,
  })

  const pageBehind = Boolean(latest?.sha && latest.sha !== 'unknown' && BUILD.sha !== 'unknown' && latest.sha !== BUILD.sha)
  const apiKnown = Boolean(apiVersion?.sha && apiVersion.sha !== 'unknown')
  const apiInSync = apiKnown && apiVersion!.sha === BUILD.sha
  const apiBehind = apiKnown && !apiInSync

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
    ? { tone: WARN, text: 'A newer version is live' }
    : apiBehind
      ? { tone: WARN, text: `API is on ${apiVersion!.short}` }
      : apiInSync
        ? { tone: OK, text: 'Live and in sync' }
        : { tone: FAINT, text: 'Checking…' }

  return (
    <footer
      className="flex items-center gap-3 flex-wrap px-4 sm:px-6"
      style={{ borderTop: `1px solid ${LINE}`, padding: '10px 0', marginTop: 24, fontSize: 11.5, color: FAINT }}
    >
      <span className="inline-flex items-center gap-1.5">
        Built by <span style={{ color: MUTED, fontWeight: 600 }}>Zulfiqar</span> with
        <Coffee size={12} aria-label="coffee" /> and <Heart size={12} aria-label="love" style={{ color: '#D4537E' }} />
      </span>

      <span aria-hidden="true">·</span>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 cursor-pointer"
        style={{ background: 'none', border: 0, padding: 0, color: FAINT, fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}
        title={BUILD.message ? `${BUILD.short} — ${BUILD.message}` : BUILD.short}
      >
        <span style={{ width: 7, height: 7, borderRadius: 999, background: status.tone, display: 'inline-block' }} />
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{BUILD.short}</span>
        <span style={{ color: status.tone }}>{status.text}</span>
      </button>

      {pageBehind && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1 cursor-pointer"
          style={{ background: '#EDE5FF', color: PURPLE_INK, border: 0, borderRadius: 999, padding: '3px 9px', fontSize: 11, fontWeight: 600 }}
        >
          <RefreshCw size={11} /> Reload for {latest!.short}
        </button>
      )}

      <span className="ml-auto" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {BUILD.committedAt ? `pushed ${ago(BUILD.committedAt)}` : ''}
      </span>

      {open && (
        <div className="basis-full" style={{ color: MUTED, fontSize: 11.5, lineHeight: 1.7, fontVariantNumeric: 'tabular-nums' }}>
          <div><b>This page</b> · {BUILD.short} · {BUILD.message || ''} · built {ago(BUILD.builtAt)}</div>
          <div><b>Published</b> · {latest?.short || '—'} {latest?.message ? `· ${latest.message}` : ''} {latest?.builtAt ? `· built ${ago(latest.builtAt)}` : ''}</div>
          <div><b>API</b> · {apiVersion?.short || 'unreachable'} {apiVersion?.message ? `· ${apiVersion.message}` : ''} {apiVersion?.startedAt ? `· started ${ago(apiVersion.startedAt)}` : ''}</div>
        </div>
      )}
    </footer>
  )
}
