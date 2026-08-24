import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { WALKTHROUGHS, walkthroughById, type Walkthrough } from './registry'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

export type WalkthroughState = { enabled: boolean; completed: string[] }

type Ctx = {
  state: WalkthroughState | undefined
  start: (id: string) => void
  setEnabled: (on: boolean) => void
  available: Walkthrough[]
  activeId: string | null
}

const WalkthroughCtx = createContext<Ctx | null>(null)

export function useWalkthroughs() {
  const ctx = useContext(WalkthroughCtx)
  if (!ctx) throw new Error('useWalkthroughs must be used inside WalkthroughProvider')
  return ctx
}

/** How long to wait for a step's target before giving up on it. */
const TARGET_TIMEOUT_MS = 2500
const POLL_MS = 80

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [searching, setSearching] = useState(false)
  // Auto-start is considered once per session, not on every route change.
  const autoStarted = useRef(false)

  const { data: state } = useQuery<WalkthroughState>({
    queryKey: ['walkthroughs'],
    queryFn: () => api.get('/walkthroughs/me').then((r) => r.data),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    retry: false,
  })

  const complete = useMutation({
    mutationFn: (id: string) => api.post('/walkthroughs/me/complete', { id }).then((r) => r.data),
    onSuccess: (d) => qc.setQueryData(['walkthroughs'], d),
  })

  const enabledMut = useMutation({
    mutationFn: (on: boolean) => api.put('/walkthroughs/me', { enabled: on }).then((r) => r.data),
    onSuccess: (d) => qc.setQueryData(['walkthroughs'], d),
  })

  const available = useMemo(
    () => WALKTHROUGHS.filter((w) => !w.roles?.length || (user?.role && w.roles.includes(user.role))),
    [user?.role],
  )

  const walkthrough = activeId ? walkthroughById(activeId) : null
  const step = walkthrough?.steps[stepIndex] ?? null

  const finish = useCallback((id: string | null) => {
    if (id) complete.mutate(id)
    setActiveId(null)
    setStepIndex(0)
    setRect(null)
  }, [complete])

  const start = useCallback((id: string) => {
    setActiveId(id)
    setStepIndex(0)
    setRect(null)
  }, [])

  // Navigate when a step asks for a different page.
  useEffect(() => {
    if (!step?.route) return
    if (location.pathname !== step.route) navigate(step.route)
  }, [step, location.pathname, navigate])

  /**
   * Find the step's target.
   *
   * Polls, because the page may still be rendering after a navigation. If it
   * never appears the step is shown centred rather than leaving someone behind
   * a dimmed screen with nothing to click — a tour that traps you is worse than
   * no tour.
   */
  useEffect(() => {
    if (!step) return
    if (!step.target) { setRect(null); setSearching(false); return }

    let alive = true
    const started = Date.now()
    setSearching(true)

    const look = () => {
      if (!alive) return
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        // Let the scroll settle before measuring, or the hole lands where the
        // element used to be.
        window.setTimeout(() => {
          if (!alive) return
          setRect(el.getBoundingClientRect())
          setSearching(false)
        }, 260)
        return
      }
      if (Date.now() - started > TARGET_TIMEOUT_MS) { setRect(null); setSearching(false); return }
      window.setTimeout(look, POLL_MS)
    }
    look()
    return () => { alive = false }
  }, [step])

  // Keep the hole aligned when the page moves under it.
  useEffect(() => {
    if (!activeId || !step?.target) return
    const sync = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [activeId, step])

  // Escape leaves, the arrow keys move.
  useEffect(() => {
    if (!activeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(activeId)
      if (e.key === 'ArrowRight') setStepIndex((i) => Math.min(i + 1, (walkthrough?.steps.length ?? 1) - 1))
      if (e.key === 'ArrowLeft') setStepIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, walkthrough, finish])

  // Start the first unseen one, once, for a user who has them switched on.
  useEffect(() => {
    if (autoStarted.current || !state || !user) return
    if (!state.enabled) { autoStarted.current = true; return }
    const next = available.find((w) => !state.completed.includes(w.id))
    autoStarted.current = true
    if (next) start(next.id)
  }, [state, user, available, start])

  const ctx = useMemo<Ctx>(() => ({
    state,
    start,
    setEnabled: (on: boolean) => enabledMut.mutate(on),
    available,
    activeId,
  }), [state, start, enabledMut, available, activeId])

  return (
    <WalkthroughCtx.Provider value={ctx}>
      {children}
      {walkthrough && step && (
        <Overlay
          rect={rect}
          searching={searching}
          title={step.title}
          body={step.body}
          placement={step.placement}
          index={stepIndex}
          total={walkthrough.steps.length}
          onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
          onNext={() => {
            if (stepIndex >= walkthrough.steps.length - 1) finish(walkthrough.id)
            else setStepIndex((i) => i + 1)
          }}
          onSkip={() => finish(walkthrough.id)}
        />
      )}
    </WalkthroughCtx.Provider>
  )
}

function Overlay({
  rect, searching, title, body, placement = 'bottom', index, total, onBack, onNext, onSkip,
}: {
  rect: DOMRect | null
  searching: boolean
  title: string
  body: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  index: number
  total: number
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}) {
  const pad = 6
  const last = index === total - 1

  // Where the card sits. With no target it is centred, which is right for an
  // opening or closing note as well as for a target that never turned up.
  const card: React.CSSProperties = rect
    ? (() => {
      const below = window.innerHeight - rect.bottom
      const putBelow = placement === 'bottom' ? below > 220 : below > 220 && placement !== 'top'
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - 372)
      return putBelow
        ? { top: rect.bottom + 14, left }
        : { top: Math.max(12, rect.top - 14), left, transform: 'translateY(-100%)' }
    })()
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-label="Walkthrough">
      {/* The dim, with a hole cut over the target using four panels rather than
          an SVG mask — simpler, and it keeps the target clickable. */}
      {rect ? (
        <>
          <div style={{ position: 'fixed', inset: 0, top: 0, height: Math.max(0, rect.top - pad), background: 'rgba(20,8,31,.55)' }} />
          <div style={{ position: 'fixed', top: rect.bottom + pad, left: 0, right: 0, bottom: 0, background: 'rgba(20,8,31,.55)' }} />
          <div style={{ position: 'fixed', top: rect.top - pad, left: 0, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2, background: 'rgba(20,8,31,.55)' }} />
          <div style={{ position: 'fixed', top: rect.top - pad, left: rect.right + pad, right: 0, height: rect.height + pad * 2, background: 'rgba(20,8,31,.55)' }} />
          <div
            style={{
              position: 'fixed', top: rect.top - pad, left: rect.left - pad,
              width: rect.width + pad * 2, height: rect.height + pad * 2,
              border: `2px solid ${PURPLE}`, borderRadius: 10, pointerEvents: 'none',
              boxShadow: '0 0 0 3px rgba(91,43,201,.25)',
            }}
          />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.55)' }} />
      )}

      <div
        style={{
          position: 'fixed', width: 360, maxWidth: 'calc(100vw - 24px)',
          background: '#fff', borderRadius: 14, padding: 18,
          boxShadow: '0 24px 60px rgba(20,8,31,.28)', ...card,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: PURPLE }}>
            Step {index + 1} of {total}
          </span>
          <button type="button" onClick={onSkip} aria-label="Close walkthrough"
            className="cursor-pointer hover:opacity-60" style={{ color: MUTED }}>
            <X size={15} />
          </button>
        </div>

        <h3 style={{ fontSize: 15.5, fontWeight: 700, color: INK, margin: '8px 0 6px' }}>{title}</h3>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: '#4A4357', margin: 0 }}>{body}</p>

        {searching && (
          <p style={{ fontSize: 11.5, color: MUTED, marginTop: 8 }}>Looking for it on the page…</p>
        )}

        <div className="flex items-center justify-between gap-2" style={{ marginTop: 16 }}>
          <button type="button" onClick={onSkip}
            className="cursor-pointer hover:underline"
            style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>
            Skip
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button type="button" onClick={onBack}
                className="rounded-full cursor-pointer"
                style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, border: '1px solid rgba(20,8,31,.16)', background: '#fff', color: INK }}>
                Back
              </button>
            )}
            <button type="button" onClick={onNext}
              className="rounded-full cursor-pointer text-white"
              style={{ padding: '7px 16px', fontSize: 12.5, fontWeight: 700, background: PURPLE }}>
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
