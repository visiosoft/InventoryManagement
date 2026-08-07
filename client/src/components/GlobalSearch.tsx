import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search, X } from 'lucide-react'
import { api } from '../lib/api'

type Hit = {
  _id: string
  contractNo: string
  status: string
  startDate?: string
  endDate?: string
  customer?: { fullName?: string }
  unit?: { unitNumber?: string }
}

const PURPLE = '#5B2BC9'
const MUTED = '#756E80'

/** Search tenants, contract numbers and units; picking a result opens the contract. */
export default function GlobalSearch() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Wait for a pause in typing so each keystroke doesn't hit the API
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250)
    return () => clearTimeout(t)
  }, [term])

  const { data: results = [], isFetching } = useQuery<Hit[]>({
    queryKey: ['global-search', debounced],
    queryFn: () => api.get('/contracts/search', { params: { q: debounced } }).then(r => r.data),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  })

  useEffect(() => { setActive(0) }, [results])

  // Close when clicking elsewhere
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Ctrl/Cmd+K focuses search from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function go(hit: Hit) {
    navigate(`/contracts/${hit._id}`)
    setOpen(false)
    setTerm('')
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
  }

  const showPanel = open && debounced.length >= 2

  return (
    <div ref={boxRef} className="relative" style={{ width: 320 }}>
      <div className="flex items-center gap-2 h-9 px-3 rounded-full border bg-white"
        style={{ borderColor: 'rgba(20,8,31,.16)' }}>
        <Search size={14} style={{ color: MUTED }} />
        <input
          ref={inputRef}
          value={term}
          onChange={e => { setTerm(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search tenant, contract no, unit…"
          className="flex-1 bg-transparent outline-none text-[13px]"
          style={{ color: '#14081F' }}
        />
        {isFetching && debounced.length >= 2 && <Loader2 size={13} className="animate-spin" style={{ color: MUTED }} />}
        {term && !isFetching && (
          <button type="button" onClick={() => { setTerm(''); inputRef.current?.focus() }}
            className="cursor-pointer" style={{ color: MUTED }}>
            <X size={13} />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 mt-1 rounded-xl border bg-white shadow-lg overflow-hidden z-50"
          style={{ borderColor: 'rgba(20,8,31,.12)', maxHeight: 380, overflowY: 'auto' }}>
          {results.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px]" style={{ color: MUTED }}>
              {isFetching ? 'Searching…' : `No tenant or contract matches “${debounced}”`}
            </p>
          ) : results.map((hit, i) => (
            <button
              key={hit._id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
              className="w-full text-left px-4 py-2.5 cursor-pointer border-t first:border-t-0"
              style={{ borderColor: 'rgba(20,8,31,.06)', background: i === active ? '#F7F3FF' : '#fff' }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold truncate" style={{ color: '#14081F' }}>
                  {hit.customer?.fullName || 'Unknown tenant'}
                </span>
                <span className="text-[11px] font-semibold shrink-0" style={{ color: PURPLE }}>
                  {hit.contractNo}
                </span>
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: MUTED }}>
                {hit.unit?.unitNumber ? `Unit ${hit.unit.unitNumber}` : 'No unit'}
                {' · '}{hit.status.replace(/_/g, ' ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
