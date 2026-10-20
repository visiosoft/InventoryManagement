import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import { PageHeader, Card, CardBody, Spinner, Button } from '../components/ui'
import { formatDate } from '../lib/utils'

/**
 * Leads that are the same person twice — almost always one saved from a
 * number typed the local way (054…) beside the WhatsApp chat's 97154…. Each
 * pair shows side by side with the one to keep pre-selected (the one linked
 * to the chat); merging brings across what only the other had and moves its
 * quotations, tasks, follow-ups and history.
 */

type L = {
  _id: string; fullName: string; phone: string; phoneNormalized: string; status: string
  owner: { _id: string; name: string } | null; source: string; createdAt: string; updatedAt: string; storageSizeValue: number; messages: number
}
type Report = { pairs: { leads: L[]; suggestedKeepId: string }[]; phoneFixes: { _id: string; fullName: string; from: string; to: string }[] }

const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const LINE = '#E5E7EB'

export default function DuplicateLeads() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [keep, setKeep] = useState<Record<string, string>>({})
  const [owner, setOwner] = useState<Record<string, string>>({})

  const { data, isLoading } = useQuery<Report>({ queryKey: ['lead-duplicates'], queryFn: () => api.get('/leads/maintenance/duplicates').then((r) => r.data) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['lead-duplicates'] }); qc.invalidateQueries({ queryKey: ['leads'] }) }
  const done = (text: string) => { setErr(''); setMsg(text); refresh() }

  const fixPhones = useMutation({
    mutationFn: () => api.post('/leads/maintenance/fix-phones').then((r) => r.data),
    onSuccess: (r: { fixed: number }) => done(`${r.fixed} phone number${r.fixed === 1 ? '' : 's'} corrected.`),
    onError: (e) => setErr(apiError(e)),
  })
  const merge = useMutation({
    mutationFn: (v: { keepId: string; dropId: string; ownerId?: string }) => api.post('/leads/maintenance/merge', v).then((r) => r.data),
    onSuccess: () => done('Merged.'),
    onError: (e) => setErr(apiError(e)),
  })
  const mergeAll = useMutation({
    mutationFn: () => api.post('/leads/maintenance/merge-all').then((r) => r.data),
    onSuccess: (r: { merged: number; failed: { error: string }[] }) => done(`${r.merged} pairs merged${r.failed.length ? `, ${r.failed.length} left to do by hand` : ''}.`),
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <div>
      <PageHeader title="Duplicate leads" subtitle="The same person saved twice — usually one typed as 05… and one from the WhatsApp chat as 9715…" />
      {isLoading || !data ? <Spinner /> : (
        <div className="space-y-4">
          {msg && <div className="rounded-lg px-3 py-2" style={{ background: '#DCFCE7', color: '#166534', fontSize: 13 }}>{msg}</div>}
          {err && <div className="rounded-lg px-3 py-2" style={{ background: '#FEE2E2', color: '#B91C1C', fontSize: 13 }}>{err}</div>}

          <Card><CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div style={{ fontSize: 13.5 }}>
                <b>{data.phoneFixes.length}</b> lead{data.phoneFixes.length === 1 ? '' : 's'} saved with a local number and no duplicate — correcting the format links them to their WhatsApp chat.
                {data.phoneFixes.length > 0 && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>e.g. {data.phoneFixes.slice(0, 3).map((f) => `${f.fullName}: ${f.from} → ${f.to}`).join(' · ')}</div>}
              </div>
              <Button disabled={!data.phoneFixes.length || fixPhones.isPending} onClick={() => fixPhones.mutate()}>
                {fixPhones.isPending ? 'Correcting…' : `Correct ${data.phoneFixes.length}`}
              </Button>
            </div>
          </CardBody></Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div style={{ fontSize: 14, fontWeight: 700 }}>{data.pairs.length} duplicate pair{data.pairs.length === 1 ? '' : 's'}</div>
            {data.pairs.length > 0 && (
              <Button variant="outline" disabled={mergeAll.isPending}
                onClick={() => { if (confirm(`Merge all ${data.pairs.length} pairs, keeping the highlighted one in each? The other is deleted after its quotes, tasks and history are moved across.`)) mergeAll.mutate() }}>
                {mergeAll.isPending ? 'Merging…' : 'Merge all as suggested'}
              </Button>
            )}
          </div>
          {data.pairs.length === 0 && <div style={{ color: '#6B7280', fontSize: 14 }}>No duplicates. 👍</div>}

          {data.pairs.map((p) => {
            const key = p.leads.map((l) => l._id).join('-')
            const keepId = keep[key] || p.suggestedKeepId
            const dropLead = p.leads.find((l) => l._id !== keepId)!
            const owners = [...new Map(p.leads.filter((l) => l.owner).map((l) => [l.owner!._id, l.owner!])).values()]
            return (
              <Card key={key}><CardBody>
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${p.leads.length}, minmax(0, 1fr))` }}>
                  {p.leads.map((l) => {
                    const on = l._id === keepId
                    return (
                      <label key={l._id} className="rounded-lg p-3 cursor-pointer" style={{ border: `2px solid ${on ? '#5B2BC9' : LINE}`, background: on ? '#F7F3FF' : '#fff' }}>
                        <div className="flex items-center gap-2">
                          <input type="radio" checked={on} onChange={() => setKeep((k) => ({ ...k, [key]: l._id }))} />
                          <Link to={`/leads/${l._id}`} style={{ fontWeight: 700 }}>{l.fullName || 'Unnamed'}</Link>
                          <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: on ? '#5B2BC9' : '#9CA3AF' }}>{on ? 'KEEP' : 'merge into the other'}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: '#4B5563', marginTop: 6, lineHeight: 1.6 }}>
                          {l.phone} <span style={{ color: '#9CA3AF' }}>(stored {l.phoneNormalized})</span><br />
                          {label(l.status)} · {l.owner?.name || 'Unassigned'} · {label(l.source)}<br />
                          {l.messages ? <span style={{ color: '#15803D' }}>{l.messages} WhatsApp messages linked</span> : <span style={{ color: '#B45309' }}>Not linked to the chat</span>}
                          {l.storageSizeValue > 0 ? ` · ${l.storageSizeValue} sq ft` : ''} · added {formatDate(l.createdAt)}
                        </div>
                      </label>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3" style={{ fontSize: 13 }}>
                  <span style={{ color: '#6B7280' }}>Owner after merging:</span>
                  <select value={owner[key] ?? ''} onChange={(e) => setOwner((o) => ({ ...o, [key]: e.target.value }))} className="h-8 border rounded-md px-2" style={{ borderColor: LINE }}>
                    <option value="">Whoever worked it last</option>
                    {owners.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
                  </select>
                  <span style={{ flex: 1 }} />
                  {p.leads.length === 2 ? (
                    <Button size="sm" disabled={merge.isPending} onClick={() => merge.mutate({ keepId, dropId: dropLead._id, ...(owner[key] ? { ownerId: owner[key] } : {}) })}>
                      Merge
                    </Button>
                  ) : <span style={{ color: '#B45309' }}>More than two — open them and merge by hand</span>}
                </div>
              </CardBody></Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
