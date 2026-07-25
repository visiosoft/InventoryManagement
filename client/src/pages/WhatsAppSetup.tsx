import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, CheckCircle2, Loader2, QrCode, RefreshCw, Unplug, Wifi, WifiOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, Spinner } from '../components/ui'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const WA_BASE = import.meta.env.VITE_WHATSAPP_LEAD_URL || ''

function waHeaders(): HeadersInit {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    const key = import.meta.env.VITE_WHATSAPP_LEAD_API_KEY
    if (key) h['x-api-key'] = key
    return h
}

async function waFetch(path: string, method: 'GET' | 'POST' = 'GET', body?: any) {
    const opts: RequestInit = { method, headers: waHeaders() }
    if (method === 'POST') opts.body = JSON.stringify(body ?? {})
    const res = await fetch(`${WA_BASE}/api${path}`, opts)
    return res.json()
}

type WaState = 'unknown' | 'qr' | 'connected' | 'loading' | 'error' | 'disconnected'

export default function WhatsAppSetup() {
    const navigate = useNavigate()
    const [state, setState] = useState<WaState>('unknown')
    const [screenshot, setScreenshot] = useState<string | null>(null)
    const [syncing, setSyncing] = useState(false)
    const [syncResult, setSyncResult] = useState<any>(null)
    const [error, setError] = useState('')
    const [checking, setChecking] = useState(true)
    const [disconnecting, setDisconnecting] = useState(false)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    async function checkStatus() {
        try {
            const data = await waFetch('/status')
            setState(data.state || 'unknown')
            setError('')
            return data.state
        } catch (e: any) {
            setState('error')
            setError(e.message || 'Cannot reach WhatsApp service')
            return 'error'
        } finally {
            setChecking(false)
        }
    }

    async function fetchQr() {
        setChecking(true)
        try {
            const data = await waFetch('/qr')
            if (data.state === 'connected') {
                setState('connected')
                setScreenshot(null)
            } else {
                setState(data.state || 'qr')
                setScreenshot(data.screenshot || null)
            }
            setError('')
        } catch (e: any) {
            setState('error')
            setError(e.message || 'Cannot reach WhatsApp service')
        } finally {
            setChecking(false)
        }
    }

    async function disconnect() {
        setDisconnecting(true)
        try {
            await waFetch('/disconnect', 'POST')
            setState('disconnected')
            setScreenshot(null)
            setSyncResult(null)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setDisconnecting(false)
        }
    }

    async function triggerSync() {
        setSyncing(true)
        setSyncResult(null)
        try {
            const data = await waFetch('/sync', 'POST')
            setSyncResult(data)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setSyncing(false)
        }
    }

    useEffect(() => {
        checkStatus()
    }, [])

    // Poll for status when showing QR (user might scan it)
    useEffect(() => {
        if (state === 'qr' || state === 'loading') {
            pollRef.current = setInterval(async () => {
                const s = await checkStatus()
                if (s === 'connected') {
                    setScreenshot(null)
                }
            }, 5000)
        }
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [state])

    const stateConfig: Record<WaState, { color: string; icon: any; label: string }> = {
        connected: { color: '#10B981', icon: Wifi, label: 'Connected' },
        qr: { color: '#F59E0B', icon: QrCode, label: 'Scan QR Code' },
        loading: { color: '#3B82F6', icon: Loader2, label: 'Loading...' },
        disconnected: { color: '#94A3B8', icon: WifiOff, label: 'Disconnected' },
        error: { color: '#EF4444', icon: WifiOff, label: 'Error' },
        unknown: { color: '#94A3B8', icon: Loader2, label: 'Checking...' },
    }

    const cfg = stateConfig[state]
    const StatusIcon = cfg.icon

    return (
        <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <button onClick={() => navigate(-1)} className="hover:opacity-70 transition-opacity" style={{ color: MUTED }}>
                    <ArrowLeft size={18} />
                </button>
                <div className="flex-1">
                    <div style={{ ...HEADING, fontSize: 22, fontWeight: 700, color: INK }}>WhatsApp Lead Automation</div>
                    <div style={{ fontSize: 14, color: MUTED, marginTop: 2 }}>Connect your WhatsApp account to automatically capture leads</div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}30` }}>
                    <StatusIcon size={14} style={{ color: cfg.color }} className={state === 'loading' || state === 'unknown' ? 'animate-spin' : ''} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
                </div>
            </div>

            {checking && state === 'unknown' && (
                <div className="flex items-center justify-center py-20">
                    <Spinner />
                </div>
            )}

            {/* Connected state */}
            {state === 'connected' && (
                <div className="space-y-6">
                    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '24px 28px' }}>
                        <div className="flex items-center gap-3 mb-4">
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#10B98115', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <CheckCircle2 size={20} style={{ color: '#10B981' }} />
                            </div>
                            <div>
                                <div style={{ ...HEADING, fontSize: 16, fontWeight: 700, color: INK }}>WhatsApp Connected</div>
                                <div style={{ fontSize: 13, color: MUTED }}>Your account is linked and ready for lead automation</div>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-3 mt-4">
                            <Button size="sm" onClick={triggerSync} disabled={syncing}>
                                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                                {syncing ? 'Syncing...' : 'Sync Now'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={disconnect} disabled={disconnecting}
                                className="text-red-600 border-red-300 hover:bg-red-50">
                                <Unplug size={13} />
                                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                            </Button>
                        </div>
                    </div>

                    {syncResult && (
                        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
                            <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>Last Sync Result</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                {[
                                    { label: 'Scraped', value: syncResult.scrapedCount ?? 0 },
                                    { label: 'New Leads', value: syncResult.createdLeads ?? 0 },
                                    { label: 'Updated', value: syncResult.updatedLeads ?? 0 },
                                    { label: 'Messages', value: syncResult.savedMessages ?? 0 },
                                ].map(s => (
                                    <div key={s.label} style={{ background: '#FAF8F5', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 24, fontWeight: 700, color: PURPLE, ...HEADING }}>{s.value}</div>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
                        <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>How It Works</div>
                        <div className="space-y-3" style={{ fontSize: 13, color: MUTED }}>
                            <div className="flex gap-3">
                                <span style={{ fontWeight: 700, color: PURPLE, minWidth: 20 }}>1.</span>
                                <span>WhatsApp conversations are scraped periodically from WhatsApp Web</span>
                            </div>
                            <div className="flex gap-3">
                                <span style={{ fontWeight: 700, color: PURPLE, minWidth: 20 }}>2.</span>
                                <span>Contacts are automatically saved as <strong style={{ color: INK }}>Leads</strong> in your system</span>
                            </div>
                            <div className="flex gap-3">
                                <span style={{ fontWeight: 700, color: PURPLE, minWidth: 20 }}>3.</span>
                                <span>WhatsApp <strong style={{ color: INK }}>labels</strong> are mapped to lead statuses (e.g. "New Customer" → qualified)</span>
                            </div>
                            <div className="flex gap-3">
                                <span style={{ fontWeight: 700, color: PURPLE, minWidth: 20 }}>4.</span>
                                <span>Messages are stored for context when following up with leads</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* QR Code state */}
            {(state === 'qr' || state === 'loading') && (
                <div className="space-y-6">
                    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '24px 28px' }}>
                        <div style={{ ...HEADING, fontSize: 16, fontWeight: 700, color: INK, marginBottom: 4 }}>Scan QR Code</div>
                        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>
                            Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → Scan this QR code
                        </div>

                        {screenshot ? (
                            <div className="flex flex-col items-center gap-4">
                                <div style={{ border: '2px solid rgba(20,8,31,0.08)', borderRadius: 12, overflow: 'hidden', maxWidth: 400 }}>
                                    <img src={screenshot} alt="WhatsApp QR Code" style={{ width: '100%', display: 'block' }} />
                                </div>
                                <div className="flex gap-3">
                                    <Button size="sm" variant="outline" onClick={fetchQr}>
                                        <RefreshCw size={13} /> Refresh QR
                                    </Button>
                                </div>
                                <div style={{ fontSize: 12, color: MUTED }}>
                                    Page auto-checks every 5 seconds. Once scanned, the status will update automatically.
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-4 py-8">
                                <Button onClick={fetchQr} disabled={checking}>
                                    <QrCode size={15} />
                                    {checking ? 'Loading...' : 'Show QR Code'}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Disconnected / Error state */}
            {(state === 'disconnected' || state === 'error') && (
                <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '24px 28px' }}>
                    <div className="flex flex-col items-center gap-4 py-8">
                        <div style={{ width: 56, height: 56, borderRadius: 14, background: state === 'error' ? '#FEF2F2' : '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <WifiOff size={24} style={{ color: state === 'error' ? '#EF4444' : '#94A3B8' }} />
                        </div>
                        <div className="text-center">
                            <div style={{ ...HEADING, fontSize: 16, fontWeight: 700, color: INK }}>
                                {state === 'error' ? 'Cannot Connect' : 'Not Connected'}
                            </div>
                            <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
                                {error || 'Connect your WhatsApp account to start capturing leads automatically'}
                            </div>
                        </div>
                        <Button onClick={fetchQr} disabled={checking}>
                            <QrCode size={15} />
                            {checking ? 'Connecting...' : 'Connect WhatsApp'}
                        </Button>
                        {state === 'error' && (
                            <div style={{ fontSize: 12, color: MUTED, maxWidth: 400, textAlign: 'center' }}>
                                Make sure the WhatsApp Lead service is running at {WA_BASE || '(not configured)'}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {error && state !== 'error' && state !== 'disconnected' && (
                <div className="mt-4" style={{ background: '#FEF2F2', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#B91C1C' }}>
                    {error}
                </div>
            )}
        </div>
    )
}
