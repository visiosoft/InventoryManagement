import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useSession } from '../lib/session'
import { INK, MUTED, ACCENT, HEAD, field, btn } from './theme'

/* Sign in, sign up (a new organisation, or joining by invitation). */

function Frame({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full" style={{ maxWidth: 420 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 22 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: ACCENT, display: 'grid', placeItems: 'center' }}><GraduationCap size={20} color="#fff" /></span>
          <span style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 18, color: INK }}>AI Training Center</span>
        </div>
        <h1 style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 28, color: INK, margin: 0 }}>{title}</h1>
        <p style={{ color: MUTED, fontSize: 14, margin: '6px 0 20px' }}>{sub}</p>
        <div style={{ background: '#fff', border: '1px solid rgba(20,8,31,.09)', borderRadius: 16, padding: 22 }}>{children}</div>
      </div>
    </div>
  )
}

const Label = ({ text, children }: { text: string; children: ReactNode }) => <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: MUTED, marginBottom: 12 }}>{text}<div style={{ marginTop: 5 }}>{children}</div></label>

export function Login() {
  const { signIn } = useSession()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try { const { data } = await api.post('/auth/login', { email, password }); signIn(data.token, data.user); nav('/') } catch (x) { setErr(apiError(x)) } finally { setBusy(false) }
  }
  return (
    <Frame title="Sign in" sub="Teach your AI agents from real conversations.">
      <form onSubmit={submit}>
        <Label text="Email"><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} /></Label>
        <Label text="Password"><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={field} /></Label>
        {err && <div style={{ color: '#B91C1C', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...btn(true), width: '100%', justifyContent: 'center', height: 40 }}>Sign in</button>
      </form>
      <div style={{ fontSize: 13, color: MUTED, marginTop: 14, textAlign: 'center' }}>New here? <Link to="/signup" style={{ color: ACCENT, fontWeight: 700 }}>Create an account</Link></div>
    </Frame>
  )
}

export function Signup({ invite }: { invite?: { token: string; email: string; org: string; role: string } }) {
  const { signIn } = useSession()
  const nav = useNavigate()
  const [f, setF] = useState({ name: '', email: invite?.email ?? '', password: '', orgName: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try { const { data } = await api.post('/auth/signup', { ...f, invite: invite?.token }); signIn(data.token, data.user); nav('/') } catch (x) { setErr(apiError(x)) } finally { setBusy(false) }
  }
  return (
    <Frame title={invite ? `Join ${invite.org}` : 'Create your account'} sub={invite ? `You were invited as ${invite.role}.` : 'Your organisation gets its own private workspace. Invite your team after.'}>
      <form onSubmit={submit}>
        <Label text="Your name"><input required value={f.name} onChange={set('name')} autoComplete="name" style={field} /></Label>
        <Label text="Work email"><input type="email" required value={f.email} onChange={set('email')} disabled={Boolean(invite)} autoComplete="email" style={field} /></Label>
        <Label text="Password (10+ characters, letters and numbers)"><input type="password" required minLength={10} value={f.password} onChange={set('password')} autoComplete="new-password" style={field} /></Label>
        {!invite && <Label text="Organisation (your business)"><input required value={f.orgName} onChange={set('orgName')} placeholder="e.g. Acme Storage" style={field} /></Label>}
        {err && <div style={{ color: '#B91C1C', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...btn(true), width: '100%', justifyContent: 'center', height: 40 }}>{invite ? 'Join' : 'Create account'}</button>
      </form>
      <div style={{ fontSize: 13, color: MUTED, marginTop: 14, textAlign: 'center' }}>Have an account? <Link to="/login" style={{ color: ACCENT, fontWeight: 700 }}>Sign in</Link></div>
    </Frame>
  )
}

/** /invite/:token — new people sign up; someone already signed in joins at once. */
export function Invite() {
  const { token = '' } = useParams()
  const { user, refresh, setOrg } = useSession()
  const nav = useNavigate()
  const [info, setInfo] = useState<{ email: string; org: string; role: string; exists: boolean } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get(`/auth/invite/${token}`).then((r) => setInfo(r.data)).catch((e) => setErr(apiError(e))) }, [token])
  async function join() {
    try { const { data } = await api.post('/auth/accept-invite', { token }); await refresh(); setOrg(data.org); nav('/') } catch (e) { setErr(apiError(e)) }
  }
  if (err) return <Frame title="Invitation" sub=""><div style={{ color: '#B91C1C' }}>{err}</div></Frame>
  if (!info) return <Frame title="Invitation" sub="Checking…"><div /></Frame>
  if (user) return (
    <Frame title={`Join ${info.org}`} sub={`As ${info.role}. Signed in as ${user.email}.`}>
      {user.email !== info.email ? <div style={{ color: '#B91C1C', fontSize: 13 }}>This invitation is for {info.email}. Sign out and sign in as that account.</div>
        : <button type="button" onClick={join} style={{ ...btn(true), width: '100%', justifyContent: 'center', height: 40 }}>Join {info.org}</button>}
    </Frame>
  )
  if (info.exists) return <Frame title={`Join ${info.org}`} sub={`Sign in as ${info.email}, then open this link again.`}><Link to="/login" style={{ ...btn(true), width: '100%', justifyContent: 'center', height: 40 }}>Sign in</Link></Frame>
  return <Signup invite={{ token, email: info.email, org: info.org, role: info.role }} />
}
