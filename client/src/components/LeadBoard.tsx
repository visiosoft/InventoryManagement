import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Phone, Mail } from 'lucide-react'
import { leadApi, type LeadPage, type LeadQuery } from '../lib/api'
import type { Lead, LeadStatus } from '../lib/types'
import { statusLabel } from './ui'

/**
 * The leads as a board: one column per stage, a card per lead. Drag a card to
 * another column to move its stage — that goes through the same "Move to…"
 * confirmation as the list, so a comment or a lost reason is still asked for.
 *
 * Each column loads its own newest leads (with the page's filters), so a
 * busy stage cannot crowd the others out. "See all" opens the list on that
 * stage.
 */

const COLUMNS: { status: LeadStatus; dot: string }[] = [
    { status: 'new', dot: '#16A34A' },
    { status: 'contact_attempted', dot: '#D97706' },
    { status: 'contacted', dot: '#0284C7' },
    { status: 'site_visit_scheduled', dot: '#1D4ED8' },
    { status: 'follow_up_scheduled', dot: '#EA580C' },
    { status: 'quotation_sent', dot: '#7C3AED' },
    { status: 'won', dot: '#059669' },
    { status: 'lost', dot: '#DC2626' },
]

const PER_COLUMN = 20
const INK = '#14081F'
const MUTED = '#756E80'
const CLOSED: LeadStatus[] = ['won', 'lost']

const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

function ago(d?: string) {
    if (!d) return ''
    const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000)
    if (mins < 60) return `${Math.max(1, mins)}m ago`
    const h = Math.round(mins / 60)
    if (h < 24) return `${h}h ago`
    const days = Math.round(h / 24)
    return days < 30 ? `${days}d ago` : new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Red: follow-up due or overdue. Amber: nothing booked. Green: booked. */
function nextStep(lead: Lead) {
    if (CLOSED.includes(lead.status)) return null
    const at = lead.followUpAt ? new Date(lead.followUpAt) : null
    const endToday = new Date(); endToday.setHours(23, 59, 59, 999)
    if (!at) return { c: '#D97706', t: 'No next step' }
    if (at <= endToday) return { c: '#DC2626', t: 'Follow-up due' }
    return { c: '#16A34A', t: `Follow-up ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` }
}

const HEAT = {
    high: { label: 'Hot', bg: '#FEE2E2', fg: '#B91C1C' },
    medium: { label: 'Warm', bg: '#FEF3C7', fg: '#B45309' },
    low: { label: 'Cold', bg: '#F1F5F9', fg: '#475569' },
} as const

export default function LeadBoard({ filters, onMove, onSeeAll }: {
    filters: Omit<LeadQuery, 'status' | 'page' | 'limit'> & { chase?: string; attemptBy?: string }
    onMove: (lead: Lead, to: LeadStatus) => void
    onSeeAll: (status: LeadStatus) => void
}) {
    const [dragging, setDragging] = useState<Lead | null>(null)
    const [over, setOver] = useState<LeadStatus | null>(null)

    const columns = useQueries({
        queries: COLUMNS.map((c) => {
            const params = { ...filters, status: c.status, page: 1, limit: PER_COLUMN }
            return {
                queryKey: ['leads', 'board', params],
                queryFn: () => leadApi.list(params),
                placeholderData: (prev: LeadPage | undefined) => prev,
            }
        }),
    })

    const drop = (to: LeadStatus) => {
        if (dragging && dragging.status !== to) onMove(dragging, to)
        setDragging(null)
        setOver(null)
    }

    return (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
            {COLUMNS.map((c, i) => {
                const page = columns[i].data
                const leads = page?.data ?? []
                const total = page?.total ?? 0
                const isOver = over === c.status && dragging?.status !== c.status
                return (
                    <section
                        key={c.status}
                        onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(c.status) } }}
                        onDragLeave={() => setOver((o) => (o === c.status ? null : o))}
                        onDrop={(e) => { e.preventDefault(); drop(c.status) }}
                        style={{
                            flex: '0 0 272px', borderRadius: 18, padding: 10,
                            background: isOver ? '#F1EAFF' : '#F4F0E8',
                            outline: isOver ? '2px dashed #5B2BC9' : 'none',
                            transition: 'background .15s',
                        }}
                    >
                        <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 12px' }}>
                            <span style={{ width: 9, height: 9, borderRadius: 99, background: c.dot }} />
                            <span style={{ fontWeight: 700, fontSize: 14, color: INK }}>{statusLabel(c.status)}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: MUTED, background: '#fff', borderRadius: 999, padding: '3px 10px' }}>
                                {total}
                            </span>
                        </header>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {columns[i].isLoading && <div style={{ padding: 16, fontSize: 13, color: MUTED }}>Loading…</div>}
                            {!columns[i].isLoading && !leads.length && (
                                <div style={{ padding: '20px 8px', fontSize: 13, color: '#B7B1C0', textAlign: 'center' }}>No leads</div>
                            )}
                            {leads.map((lead) => {
                                const step = nextStep(lead)
                                const heat = lead.intent && !CLOSED.includes(lead.status) ? HEAT[lead.intent.band] : null
                                return (
                                    <article
                                        key={lead._id}
                                        draggable
                                        onDragStart={(e) => { setDragging(lead); e.dataTransfer.effectAllowed = 'move' }}
                                        onDragEnd={() => { setDragging(null); setOver(null) }}
                                        style={{
                                            background: '#fff', borderRadius: 14, padding: 12,
                                            border: '1px solid rgba(20,8,31,.08)', boxShadow: '0 1px 2px rgba(20,8,31,.05)',
                                            cursor: 'grab', opacity: dragging?._id === lead._id ? 0.4 : 1,
                                        }}
                                    >
                                        <Link to={`/leads/${lead._id}`} draggable={false} style={{ display: 'flex', alignItems: 'center', gap: 10, color: INK, textDecoration: 'none' }}>
                                            <span style={{ width: 36, height: 36, flex: '0 0 auto', borderRadius: 999, background: '#EDE5FF', color: '#4A1FA0', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>
                                                {initials(lead.fullName)}
                                            </span>
                                            <span style={{ minWidth: 0 }}>
                                                <span style={{ display: 'block', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.fullName}</span>
                                                <span style={{ display: 'block', fontSize: 12, color: MUTED }}>{ago(lead.leadDateTime)}{lead.owner?.name ? ` · ${lead.owner.name}` : ' · Unassigned'}</span>
                                            </span>
                                        </Link>

                                        <div style={{ borderTop: '1px solid rgba(20,8,31,.06)', margin: '10px 0 8px' }} />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#4A4357' }}>
                                            <Phone size={13} style={{ color: MUTED }} /> {lead.phone || '—'}
                                        </div>
                                        {lead.email && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#4A4357', marginTop: 4, minWidth: 0 }}>
                                                <Mail size={13} style={{ color: MUTED, flex: '0 0 auto' }} />
                                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.email}</span>
                                            </div>
                                        )}

                                        {(heat || step) && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                                                {heat && (
                                                    <span title={lead.intent?.reason} style={{ background: heat.bg, color: heat.fg, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 700 }}>{heat.label}</span>
                                                )}
                                                {step && (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: '#4A4357' }}>
                                                        <span style={{ width: 7, height: 7, borderRadius: 99, background: step.c }} />{step.t}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </article>
                                )
                            })}
                            {total > leads.length && (
                                <button
                                    type="button"
                                    onClick={() => onSeeAll(c.status)}
                                    style={{ border: 0, background: 'none', color: '#5B2BC9', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 8 }}
                                >
                                    See all {total} →
                                </button>
                            )}
                        </div>
                    </section>
                )
            })}
        </div>
    )
}
