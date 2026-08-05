import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Search } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Site } from '../lib/site'
import { Button, Field, Input, Modal, Spinner } from '../components/ui'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

export default function Sites() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Site | null>(null)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const { data: sites = [], isLoading } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: () => api.get('/sites').then(r => r.data),
  })

  const saveMut = useMutation({
    mutationFn: (body: { id?: string; name: string; code: string; address: string; hidden: boolean }) =>
      body.id ? api.put(`/sites/${body.id}`, body) : api.post('/sites', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); setEditing(null); setAdding(false); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/sites/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); setEditing(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    saveMut.mutate({
      id: editing?._id,
      name: String(f.get('name') || ''),
      code: String(f.get('code') || ''),
      address: String(f.get('address') || ''),
      hidden: f.get('hidden') === 'on',
    })
  }

  const filtered = sites.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.code.toLowerCase().includes(search.toLowerCase()),
  )

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 style={{ ...HEADING, fontWeight: 700, fontSize: 26, margin: 0, color: INK }}>Sites</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: MUTED }}>{sites.length} {sites.length === 1 ? 'facility' : 'facilities'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 h-9 px-3 rounded-full border bg-white" style={{ borderColor: 'rgba(20,8,31,.16)' }}>
            <Search size={14} style={{ color: MUTED }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search site…"
              className="outline-none text-[13px] w-36 bg-transparent" />
          </div>
          {isAdmin && (
            <Button onClick={() => { setErr(''); setAdding(true) }}><Plus size={15} />Add site</Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: 'rgba(20,8,31,.10)' }}>
        {filtered.length === 0 && (
          <p className="text-sm text-center py-12" style={{ color: MUTED }}>No sites found.</p>
        )}
        {filtered.map((s, i) => {
          const total = s.stats?.total ?? 0
          const occupied = (s.stats?.occupied ?? 0) + (s.stats?.reserved ?? 0)
          const pct = total ? Math.round((occupied / total) * 100) : 0
          return (
            <div key={s._id}
              onClick={() => { if (isAdmin) { setErr(''); setEditing(s) } }}
              className={isAdmin ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''}
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', borderTop: i > 0 ? '1px solid rgba(20,8,31,.08)' : 'none' }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#F7F3FF', border: '1px solid #EDE5FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={20} style={{ color: PURPLE }} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: INK }} className="truncate">
                  {s.name}
                  {s.isDefault && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: MUTED }}>· default</span>}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 12.5, color: MUTED }} className="truncate">{[s.code, s.address].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              {s.hidden && (
                <span style={{ padding: '4px 12px', borderRadius: 8, background: '#FDF3D8', color: '#8A6A2F', fontSize: 12, fontWeight: 700 }}>Hidden</span>
              )}
              <div style={{ width: 160, flexShrink: 0 }} className="hidden sm:block">
                <div style={{ height: 8, borderRadius: 999, background: '#EDE9F5', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: PURPLE, borderRadius: 999 }} />
                </div>
                <p style={{ margin: '5px 0 0', fontSize: 12, color: MUTED, textAlign: 'right' }}>{pct}% occupied · {total} units</p>
              </div>
            </div>
          )
        })}
      </div>

      {(adding || editing) && (
        <Modal open title={editing ? `Edit ${editing.name}` : 'Add site'} onClose={() => { setAdding(false); setEditing(null) }}>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Site name"><Input name="name" defaultValue={editing?.name} placeholder="Jebel Ali Facility" required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code"><Input name="code" defaultValue={editing?.code} placeholder="JAF" /></Field>
              <Field label="Address"><Input name="address" defaultValue={editing?.address} placeholder="Jebel Ali, Dubai" /></Field>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" name="hidden" defaultChecked={editing?.hidden ?? false} className="h-4 w-4 rounded" />
              <span className="text-sm">Hidden — not shown in the site switcher</span>
            </label>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex items-center justify-between gap-2 pt-1">
              {editing && !editing.isDefault ? (
                <button type="button"
                  onClick={() => { if (window.confirm(`Delete ${editing.name}?`)) deleteMut.mutate(editing._id) }}
                  className="text-sm font-semibold text-red-600 hover:underline cursor-pointer">Delete site</button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="ghost" type="button" onClick={() => { setAdding(false); setEditing(null) }}>Cancel</Button>
                <Button type="submit" disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving…' : 'Save'}</Button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
