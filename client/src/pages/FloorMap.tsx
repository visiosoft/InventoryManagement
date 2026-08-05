import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Spinner } from '../components/ui'

// ─── Types ────────────────────────────────────────────────────────────────
type ShapeType = 'unit' | 'walkway' | 'staircase' | 'lift' | 'entrance' | 'office' | 'toilet' | 'loading' | 'wall' | 'column' | 'label'
type UnitStatus = 'available' | 'hold' | 'occupied'

interface Shape {
  id: string
  type: ShapeType
  x: number // metres
  y: number
  w: number
  h: number
  num?: string
  status?: UnitStatus
  text?: string
  rate?: number // AED / 4 weeks, for units not (yet) in the system
}

interface Floor {
  id: string
  name: string
  prefix: string
  rate: number // AED per sqft per month
  width: number // metres
  depth: number
  system: 'metric' | 'imperial'
  bgImage?: string | null
  bgOpacity: number
  shapes: Shape[]
}

interface FacilityDoc {
  facilityName: string
  floors: Floor[]
}

// ─── Constants & helpers ──────────────────────────────────────────────────
const STORAGE_KEY = 'pb_floorplan_v1'
const M2FT = 3.28084
const SQM2SQFT = 10.7639
const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const uid = () => Math.random().toString(36).slice(2, 10)

const PALETTE: { type: ShapeType; name: string; color: string }[] = [
  { type: 'unit', name: 'Storage unit', color: '#FFFFFF' },
  { type: 'walkway', name: 'Walkway', color: '#F4F1F8' },
  { type: 'staircase', name: 'Staircase', color: '#E4DEF2' },
  { type: 'lift', name: 'Lift', color: '#E8DEFF' },
  { type: 'entrance', name: 'Entrance', color: '#CDEBD8' },
  { type: 'office', name: 'Office / reception', color: '#F6EDDA' },
  { type: 'toilet', name: 'Toilet', color: '#DCEFF7' },
  { type: 'loading', name: 'Loading bay', color: '#FFE8D2' },
  { type: 'wall', name: 'Wall', color: '#14081F' },
  { type: 'column', name: 'Column', color: '#4A4357' },
  { type: 'label', name: 'Text label', color: 'transparent' },
]

const DEFAULT_SIZE: Record<ShapeType, [number, number]> = {
  unit: [3, 3], walkway: [10, 1.5], staircase: [3, 3], lift: [2, 2], entrance: [3, 0.6],
  office: [4, 3], toilet: [2, 2], loading: [4, 4], wall: [5, 0.2], column: [0.4, 0.4], label: [4, 1],
}

const toDisp = (m: number, sys: 'metric' | 'imperial') => sys === 'imperial' ? m * M2FT : m
const fromDisp = (v: number, sys: 'metric' | 'imperial') => sys === 'imperial' ? v / M2FT : v
const areaSqft = (s: Shape) => s.w * s.h * SQM2SQFT
const round2 = (n: number) => Math.round(n * 100) / 100

function sizeClass(sqft: number): { cls: string; fits: string } {
  if (sqft <= 30) return { cls: 'XS', fits: 'a few boxes' }
  if (sqft <= 60) return { cls: 'S', fits: 'studio contents' }
  if (sqft <= 120) return { cls: 'M', fits: '1-bed home' }
  if (sqft <= 220) return { cls: 'L', fits: '2–3 bed home' }
  return { cls: 'XL', fits: 'villa or stock' }
}

function nextUnitNum(floor: Floor): string {
  let max = 0
  for (const s of floor.shapes) {
    if (s.type !== 'unit' || !s.num) continue
    const m = s.num.match(/(\d+)\s*$/)
    if (m) max = Math.max(max, parseInt(m[1]))
  }
  return `${floor.prefix}${String(max + 1).padStart(2, '0')}`
}

function bumpNum(num: string, by: number): string {
  const m = num.match(/^(.*?)(\d+)\s*$/)
  if (!m) return `${num}-${by}`
  return `${m[1]}${String(parseInt(m[2]) + by).padStart(m[2].length, '0')}`
}

// Seed floors from real units in the database
function seedFromUnits(units: any[]): FacilityDoc {
  const byFloor = new Map<string, any[]>()
  for (const u of units) {
    const f = (u.floor || 'F1').toString()
    if (!byFloor.has(f)) byFloor.set(f, [])
    byFloor.get(f)!.push(u)
  }
  if (byFloor.size === 0) byFloor.set('F1', [])

  const floors: Floor[] = [...byFloor.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([name, list]) => {
      const sorted = [...list].sort((a, b) => String(a.unitNumber).localeCompare(String(b.unitNumber), undefined, { numeric: true }))
      const prefixMatch = sorted[0]?.unitNumber?.toString().match(/^(.*?)\d+\s*$/)
      const prefix = prefixMatch ? prefixMatch[1] : `${name}-`
      const width = 42
      const shapes: Shape[] = []
      let x = 1, y = 1, rowH = 0
      for (const u of sorted) {
        const sqft = u.sizeSqf || 100
        let side = Math.sqrt(sqft / SQM2SQFT)
        side = Math.max(1.5, Math.min(6, Math.round(side * 2) / 2))
        if (x + side > width - 1) {
          shapes.push({ id: uid(), type: 'walkway', x: 1, y: y + rowH, w: width - 2, h: 1.5 })
          y += rowH + 1.5
          x = 1
          rowH = 0
        }
        shapes.push({
          id: uid(), type: 'unit', x, y, w: side, h: side,
          num: String(u.unitNumber),
          status: u.status === 'occupied' ? 'occupied' : u.status === 'available' ? 'available' : 'hold',
        })
        x += side
        rowH = Math.max(rowH, side)
      }
      const depth = Math.max(20, Math.ceil(y + rowH + 2))
      return { id: uid(), name, prefix, rate: 10, width, depth, system: 'imperial' as const, bgImage: null, bgOpacity: 40, shapes }
    })

  return { facilityName: 'Al Quoz Facility', floors }
}

// ─── Component ────────────────────────────────────────────────────────────
export default function FloorMap() {
  const [doc, setDoc] = useState<FacilityDoc | null>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
  })
  const [floorIdx, setFloorIdx] = useState(0)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [tool, setTool] = useState<ShapeType | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [zoom, setZoom] = useState(16) // px per metre
  const [grid, setGrid] = useState(0.5)
  const [snapOn, setSnapOn] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | UnitStatus>('all')
  const [sizeF, setSizeF] = useState<number | null>(null)
  const [repeatN, setRepeatN] = useState(5)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [saveState, setSaveState] = useState('')

  const planRef = useRef<HTMLDivElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const bgRef = useRef<HTMLInputElement>(null)
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])
  const lastFieldPush = useRef(0)
  const dragRef = useRef<null | {
    kind: 'move' | 'resize' | 'marquee'
    startX: number
    startY: number
    dir?: string
    orig: { id: string; x: number; y: number; w: number; h: number }[]
    moved: boolean
  }>(null)

  const stateRef = useRef({ doc, sel, floorIdx, mode, grid, zoom, snapOn })
  stateRef.current = { doc, sel, floorIdx, mode, grid, zoom, snapOn }

  const { data: apiUnits = [], isFetched } = useQuery<any[]>({
    queryKey: ['units-for-map'],
    queryFn: () => api.get('/units').then(r => Array.isArray(r.data) ? r.data : r.data.data ?? []),
  })

  const { data: serverPlan, isFetched: planFetched } = useQuery<{ doc: FacilityDoc | null; updatedAt: string | null; updatedBy: string }>({
    queryKey: ['floor-plan'],
    queryFn: () => api.get('/floor-plan').then(r => r.data),
  })

  type OccInfo = { contractId: string; contractNo: string; customerName: string; startDate: string; endDate: string; status: string }
  const { data: occupancy = {} } = useQuery<Record<string, OccInfo>>({
    queryKey: ['floor-plan-occupancy'],
    queryFn: () => api.get('/floor-plan/occupancy').then(r => r.data),
  })
  const navigate = useNavigate()

  // First load priority: local autosave → saved system copy → seed from live units
  useEffect(() => {
    if (doc || !planFetched || !isFetched) return
    if (serverPlan?.doc && Array.isArray(serverPlan.doc.floors)) setDoc(serverPlan.doc)
    else setDoc(seedFromUnits(apiUnits))
  }, [doc, planFetched, isFetched, serverPlan, apiUnits])

  // Save to system (backend database)
  const saveMut = useMutation({
    mutationFn: (d: FacilityDoc) => api.put('/floor-plan', { doc: d }),
    onSuccess: () => setSaveState('Saved to system ✓'),
    onError: () => setSaveState('System save failed — try again'),
  })
  const saveToSystem = () => {
    if (!stateRef.current.doc || saveMut.isPending) return
    setSaveState('Saving to system…')
    saveMut.mutate(stateRef.current.doc)
  }

  // Autosave
  useEffect(() => {
    if (!doc) return
    setSaveState('Saving…')
    const t = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)); setSaveState('All changes saved') } catch { setSaveState('Save failed (storage full)') }
    }, 600)
    return () => clearTimeout(t)
  }, [doc])

  const floor = doc?.floors[Math.min(floorIdx, (doc?.floors.length ?? 1) - 1)] ?? null

  // Fit the floor to the visible canvas width
  const fitZoom = () => {
    const el = canvasWrapRef.current
    const d = stateRef.current.doc
    if (!el || !d) return
    const f = d.floors[Math.min(stateRef.current.floorIdx, d.floors.length - 1)]
    if (!f) return
    const z = Math.max(4, Math.min(40, (el.clientWidth - 52) / f.width))
    setZoom(Math.round(z * 100) / 100)
  }

  // Default to a readable zoom: smallest unit renders ~48px, canvas scrolls for the rest
  const hasDoc = !!doc
  useEffect(() => {
    const t = setTimeout(() => {
      const d = stateRef.current.doc
      if (!d) return
      const f = d.floors[Math.min(stateRef.current.floorIdx, d.floors.length - 1)]
      if (!f) return
      const unitShapes = f.shapes.filter(s => s.type === 'unit')
      const minSide = unitShapes.length ? Math.min(...unitShapes.map(u => Math.min(u.w, u.h))) : 3
      setZoom(round2(Math.min(60, Math.max(16, 48 / minSide))))
    }, 60)
    return () => clearTimeout(t)
  }, [floorIdx, hasDoc])

  const unitInfoMap = useMemo(() => {
    const m = new Map<string, { id: string; price: number | null; sizeSqf: number | null }>()
    for (const u of apiUnits) if (u.unitNumber) m.set(String(u.unitNumber), { id: u._id, price: u.price ?? null, sizeSqf: u.sizeSqf ?? null })
    return m
  }, [apiUnits])

  const qc = useQueryClient()
  const rateMut = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) => api.put(`/units/${id}`, { price }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['units-for-map'] }); setSaveState('Rate saved to system ✓') },
    onError: () => setSaveState('Rate save failed — try again'),
  })

  // ── Mutation helpers ────────────────────────────────────────────────────
  const pushUndo = () => {
    const d = stateRef.current.doc
    if (!d) return
    undoRef.current.push(JSON.stringify(d))
    if (undoRef.current.length > 60) undoRef.current.shift()
    redoRef.current = []
  }
  const pushUndoField = () => {
    const now = Date.now()
    if (now - lastFieldPush.current > 1000) { pushUndo(); lastFieldPush.current = now }
  }
  const undo = () => {
    const prev = undoRef.current.pop()
    if (!prev || !stateRef.current.doc) return
    redoRef.current.push(JSON.stringify(stateRef.current.doc))
    setDoc(JSON.parse(prev))
    setSel([])
  }
  const redo = () => {
    const next = redoRef.current.pop()
    if (!next || !stateRef.current.doc) return
    undoRef.current.push(JSON.stringify(stateRef.current.doc))
    setDoc(JSON.parse(next))
    setSel([])
  }

  const updateFloor = (fn: (f: Floor) => Floor) => {
    setDoc(d => {
      if (!d) return d
      const idx = Math.min(stateRef.current.floorIdx, d.floors.length - 1)
      return { ...d, floors: d.floors.map((f, i) => i === idx ? fn(f) : f) }
    })
  }
  const updateShapes = (fn: (shapes: Shape[]) => Shape[]) => updateFloor(f => ({ ...f, shapes: fn(f.shapes) }))
  const updateSelShapes = (fn: (s: Shape) => Shape) => {
    const ids = new Set(stateRef.current.sel)
    updateShapes(shapes => shapes.map(s => ids.has(s.id) ? fn(s) : s))
  }

  const snap = (v: number) => Math.round(v / stateRef.current.grid) * stateRef.current.grid

  // ── Placement ───────────────────────────────────────────────────────────
  const placeShape = (px: number, py: number) => {
    if (!tool || !floor) return
    pushUndo()
    const [w, h] = DEFAULT_SIZE[tool]
    const x = Math.max(0, snap(px - w / 2))
    const y = Math.max(0, snap(py - h / 2))
    const s: Shape = { id: uid(), type: tool, x, y, w, h }
    if (tool === 'unit') { s.num = nextUnitNum(floor); s.status = 'available' }
    if (tool === 'label') s.text = 'Label'
    updateShapes(shapes => [...shapes, s])
    setSel([s.id])
  }

  // ── Drag machinery ──────────────────────────────────────────────────────
  const planCoords = (e: MouseEvent | React.MouseEvent) => {
    const rect = planRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / stateRef.current.zoom, y: (e.clientY - rect.top) / stateRef.current.zoom }
  }

  const beginDrag = (kind: 'move' | 'resize' | 'marquee', e: React.MouseEvent, dir?: string) => {
    const d = stateRef.current.doc
    if (!d) return
    const f = d.floors[Math.min(stateRef.current.floorIdx, d.floors.length - 1)]
    const p = planCoords(e)
    const ids = new Set(stateRef.current.sel)
    dragRef.current = {
      kind, dir,
      startX: p.x, startY: p.y,
      orig: f.shapes.filter(s => ids.has(s.id)).map(s => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
      moved: false,
    }
    if (kind === 'move' || kind === 'resize') pushUndo()

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const q = planCoords(ev)
      const dx = q.x - drag.startX
      const dy = q.y - drag.startY
      if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) drag.moved = true

      if (drag.kind === 'marquee') {
        setMarquee({
          x: Math.min(drag.startX, q.x), y: Math.min(drag.startY, q.y),
          w: Math.abs(dx), h: Math.abs(dy),
        })
        return
      }

      const origMap = new Map(drag.orig.map(o => [o.id, o]))
      updateShapes(shapes => shapes.map(s => {
        const o = origMap.get(s.id)
        if (!o) return s
        if (drag.kind === 'move') {
          let nx = snap(o.x + dx)
          let ny = snap(o.y + dy)
          // flush-snap to neighbours (single selection only)
          if (stateRef.current.snapOn && drag.orig.length === 1) {
            const t = 0.2
            for (const other of shapes) {
              if (other.id === s.id) continue
              if (Math.abs(nx - (other.x + other.w)) < t) nx = other.x + other.w
              else if (Math.abs(nx + o.w - other.x) < t) nx = other.x - o.w
              else if (Math.abs(nx - other.x) < t) nx = other.x
              if (Math.abs(ny - (other.y + other.h)) < t) ny = other.y + other.h
              else if (Math.abs(ny + o.h - other.y) < t) ny = other.y - o.h
              else if (Math.abs(ny - other.y) < t) ny = other.y
            }
          }
          return { ...s, x: Math.max(0, nx), y: Math.max(0, ny) }
        }
        // resize
        const dir2 = drag.dir!
        let { x, y, w, h } = o
        if (dir2.includes('e')) w = Math.max(0.3, snap(o.w + dx))
        if (dir2.includes('s')) h = Math.max(0.3, snap(o.h + dy))
        if (dir2.includes('w')) { const nx = Math.min(snap(o.x + dx), o.x + o.w - 0.3); w = o.w + (o.x - nx); x = nx }
        if (dir2.includes('n')) { const ny = Math.min(snap(o.y + dy), o.y + o.h - 0.3); h = o.h + (o.y - ny); y = ny }
        return { ...s, x, y, w: round2(w), h: round2(h) }
      }))
    }

    const onUp = (ev: MouseEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (drag?.kind === 'marquee') {
        const q = planCoords(ev)
        const mx = Math.min(drag.startX, q.x), my = Math.min(drag.startY, q.y)
        const mw = Math.abs(q.x - drag.startX), mh = Math.abs(q.y - drag.startY)
        setMarquee(null)
        if (mw > 0.1 || mh > 0.1) {
          const d2 = stateRef.current.doc
          if (!d2) return
          const f2 = d2.floors[Math.min(stateRef.current.floorIdx, d2.floors.length - 1)]
          const hit = f2.shapes.filter(s => s.x < mx + mw && s.x + s.w > mx && s.y < my + mh && s.y + s.h > my).map(s => s.id)
          setSel(hit)
        }
      } else if (drag && !drag.moved && (drag.kind === 'move' || drag.kind === 'resize')) {
        // click without movement — undo entry not needed
        undoRef.current.pop()
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const onCanvasDown = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).dataset?.plan !== '1') return
    if (mode === 'edit') {
      if (tool) { const p = planCoords(e); placeShape(p.x, p.y); return }
      setSel([])
      beginDrag('marquee', e)
    } else {
      setSel([])
    }
  }

  const onShapeDown = (e: React.MouseEvent, s: Shape) => {
    e.stopPropagation()
    if (mode === 'view') {
      if (s.type === 'unit') setSel([s.id])
      else setSel([])
      return
    }
    if (tool) { setTool(null) }
    let nextSel: string[]
    if (e.shiftKey) {
      nextSel = sel.includes(s.id) ? sel.filter(i => i !== s.id) : [...sel, s.id]
    } else {
      nextSel = sel.includes(s.id) ? sel : [s.id]
    }
    setSel(nextSel)
    stateRef.current.sel = nextSel
    if (!e.shiftKey) beginDrag('move', e)
  }

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const st = stateRef.current
      if (st.mode !== 'edit') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
        return
      }
      if (e.key === 'Escape') { setTool(null); setSel([]); return }
      if (!st.sel.length) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        pushUndo()
        const ids = new Set(st.sel)
        updateShapes(shapes => shapes.filter(s => !ids.has(s.id)))
        setSel([])
        return
      }
      const step = st.grid
      let dx = 0, dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      pushUndoField()
      updateSelShapes(s => ({ ...s, x: Math.max(0, round2(s.x + dx)), y: Math.max(0, round2(s.y + dy)) }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Actions ─────────────────────────────────────────────────────────────
  const rotateSel = () => {
    pushUndo()
    updateSelShapes(s => ({ ...s, x: round2(s.x + (s.w - s.h) / 2), y: round2(s.y + (s.h - s.w) / 2), w: s.h, h: s.w }))
  }
  const duplicateSel = () => {
    if (!floor) return
    pushUndo()
    const ids = new Set(sel)
    const clones: Shape[] = []
    let bump = 0
    for (const s of floor.shapes) {
      if (!ids.has(s.id)) continue
      const c: Shape = { ...s, id: uid(), x: round2(s.x + 0.5), y: round2(s.y + 0.5) }
      if (s.type === 'unit') { bump += 1; c.num = bumpNum(nextUnitNum(floor), bump - 1) }
      clones.push(c)
    }
    updateShapes(shapes => [...shapes, ...clones])
    setSel(clones.map(c => c.id))
  }
  const doRepeat = () => {
    if (!floor || sel.length !== 1) return
    const src = floor.shapes.find(s => s.id === sel[0])
    if (!src || src.type !== 'unit') return
    pushUndo()
    const clones: Shape[] = []
    for (let i = 1; i <= repeatN; i++) {
      clones.push({
        ...src, id: uid(), x: round2(src.x + i * src.w),
        num: src.num ? bumpNum(src.num, i) : undefined,
        status: 'available',
      })
    }
    updateShapes(shapes => [...shapes, ...clones])
    setSel([src.id, ...clones.map(c => c.id)])
  }
  const alignLeft = () => {
    if (!floor) return
    pushUndo()
    const ids = new Set(sel)
    const min = Math.min(...floor.shapes.filter(s => ids.has(s.id)).map(s => s.x))
    updateSelShapes(s => ({ ...s, x: min }))
  }
  const alignTop = () => {
    if (!floor) return
    pushUndo()
    const ids = new Set(sel)
    const min = Math.min(...floor.shapes.filter(s => ids.has(s.id)).map(s => s.y))
    updateSelShapes(s => ({ ...s, y: min }))
  }
  const distributeRow = () => {
    if (!floor || sel.length < 3) return
    pushUndo()
    const ids = new Set(sel)
    const items = floor.shapes.filter(s => ids.has(s.id)).sort((a, b) => a.x - b.x)
    const first = items[0], last = items[items.length - 1]
    const span = last.x + last.w - first.x
    const sumW = items.reduce((a, s) => a + s.w, 0)
    const gap = (span - sumW) / (items.length - 1)
    let cursor = first.x
    const newX = new Map<string, number>()
    for (const it of items) { newX.set(it.id, round2(cursor)); cursor += it.w + gap }
    updateShapes(shapes => shapes.map(s => newX.has(s.id) ? { ...s, x: newX.get(s.id)! } : s))
  }

  const addFloor = () => {
    pushUndo()
    setDoc(d => {
      if (!d) return d
      const n = d.floors.length + 1
      return {
        ...d,
        floors: [...d.floors, { id: uid(), name: `F${n}`, prefix: `F${n}-`, rate: 10, width: 42, depth: 24, system: 'imperial', bgImage: null, bgOpacity: 40, shapes: [] }],
      }
    })
    setFloorIdx(doc?.floors.length ?? 0)
  }
  const deleteFloor = () => {
    if (!doc || doc.floors.length <= 1) return
    if (!window.confirm('Delete this floor and everything on it?')) return
    pushUndo()
    setDoc(d => d ? { ...d, floors: d.floors.filter((_, i) => i !== floorIdx) } : d)
    setFloorIdx(0)
    setSel([])
  }
  const clearFloor = () => {
    if (!window.confirm('Remove all shapes from this floor?')) return
    pushUndo()
    updateShapes(() => [])
    setSel([])
  }
  const resetAll = () => {
    if (!window.confirm('Reset the whole map from your live units data? This replaces all floors.')) return
    pushUndo()
    setDoc(seedFromUnits(apiUnits))
    setFloorIdx(0)
    setSel([])
  }

  const exportFile = () => {
    if (!doc) return
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.facilityName.replace(/\s+/g, '-').toLowerCase()}-floorplan.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        if (!parsed.floors || !Array.isArray(parsed.floors)) throw new Error('bad file')
        pushUndo()
        setDoc(parsed)
        setFloorIdx(0)
        setSel([])
      } catch { window.alert('Could not read that file — is it a floor plan export?') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }
  const onBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      pushUndoField()
      updateFloor(f => ({ ...f, bgImage: String(reader.result) }))
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── Derived ─────────────────────────────────────────────────────────────
  const selShapes = useMemo(() => floor ? floor.shapes.filter(s => sel.includes(s.id)) : [], [floor, sel])
  const single = selShapes.length === 1 ? selShapes[0] : null
  const units = floor?.shapes.filter(s => s.type === 'unit') ?? []
  const availCount = units.filter(u => u.status === 'available').length
  const holdCount = units.filter(u => u.status === 'hold').length
  const occCount = units.filter(u => u.status === 'occupied').length
  const lettableSqft = units.reduce((a, u) => a + areaSqft(u), 0)
  const sizesSqft = units.map(u => Math.round(areaSqft(u)))
  const sizeRange = sizesSqft.length ? `${Math.min(...sizesSqft)}–${Math.max(...sizesSqft)} sqft` : '—'
  // Effective rate: system unit price → rate stored on the shape → computed from floor rate
  const unitPrice = (s: Shape) => {
    const info = unitInfoMap.get(s.num ?? '')
    if (info?.price) return info.price
    if (s.rate) return s.rate
    return Math.round(areaSqft(s) * (floor?.rate ?? 0))
  }
  const potentialRevenue = floor ? Math.round(units.reduce((a, u) => a + unitPrice(u), 0)) : 0

  // Save a unit's rate: to the system unit record when it exists, else on the map shape
  const commitRate = (s: Shape, val: string) => {
    const price = parseFloat(val)
    if (isNaN(price) || price < 0) return
    pushUndoField()
    updateShapes(shapes => shapes.map(x => x.id === s.id ? { ...x, rate: price } : x))
    const info = unitInfoMap.get(s.num ?? '')
    if (info?.id) rateMut.mutate({ id: info.id, price })
    else setSaveState('Rate saved on map (unit not in system yet)')
  }

  const dimUnit = floor?.system === 'imperial' ? 'ft' : 'm'
  const fmtDim = (m: number) => round2(toDisp(m, floor?.system ?? 'metric'))
  const fmtArea = (s: Shape) => floor?.system === 'imperial'
    ? `${Math.round(areaSqft(s))} sqft`
    : `${round2(s.w * s.h)} m²`
  const fmtAreaAlt = (s: Shape) => floor?.system === 'imperial'
    ? `${round2(s.w * s.h)} m²`
    : `${Math.round(areaSqft(s))} sqft`

  const isDimmed = (s: Shape): boolean => {
    if (mode !== 'view' || s.type !== 'unit') return false
    if (query && !(s.num ?? '').toLowerCase().includes(query.toLowerCase())) return true
    if (filter !== 'all' && s.status !== filter) return true
    if (sizeF) {
      // Use the system size when the unit exists; otherwise the drawn area ±15%
      const info = unitInfoMap.get(s.num ?? '')
      if (info?.sizeSqf != null) { if (info.sizeSqf !== sizeF) return true }
      else if (Math.abs(areaSqft(s) - sizeF) / sizeF > 0.15) return true
    }
    return false
  }

  // ── Styling helpers ─────────────────────────────────────────────────────
  const ghostBtn = 'h-8 px-3 rounded-full border text-[12.5px] font-semibold cursor-pointer bg-white hover:bg-muted/40 transition-colors'
  const ghostBtnStyle = { borderColor: 'rgba(20,8,31,.16)', color: '#4A4357' } as const
  const fieldCls = 'h-9 px-3 rounded-lg border text-[13px] outline-none w-full'
  const fieldStyle = { borderColor: 'rgba(20,8,31,.16)', color: INK, background: '#fff' } as const

  const pill = (active: boolean) => ({
    height: 30, padding: '0 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 600, transition: 'all .15s',
    background: active ? PURPLE : 'transparent', color: active ? '#fff' : '#4A1FA0',
  } as React.CSSProperties)

  const filterPill = (active: boolean) => ({
    height: 34, padding: '0 14px', borderRadius: 999, cursor: 'pointer',
    fontSize: 13, fontWeight: 600,
    border: active ? `1px solid ${PURPLE}` : '1px solid rgba(20,8,31,.16)',
    background: active ? '#F7F3FF' : '#fff', color: active ? '#4A1FA0' : '#4A4357',
  } as React.CSSProperties)

  function shapeStyle(s: Shape): React.CSSProperties {
    const z = zoom
    const base: React.CSSProperties = {
      position: 'absolute', left: s.x * z, top: s.y * z, width: s.w * z, height: s.h * z,
      boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', overflow: 'hidden', userSelect: 'none',
      cursor: mode === 'edit' ? 'move' : s.type === 'unit' ? 'pointer' : 'default',
      opacity: isDimmed(s) ? 0.22 : 1,
      transition: 'opacity .15s',
    }
    const selected = sel.includes(s.id)
    const selRing = selected ? { outline: `2px solid ${PURPLE}`, outlineOffset: 1, zIndex: 30, boxShadow: '0 4px 14px rgba(91,43,201,.25)' } : {}
    switch (s.type) {
      case 'unit': {
        const st = s.status ?? 'available'
        const bg = st === 'occupied' ? '#EDE3CF' : st === 'hold' ? '#EDE5FF' : '#FFFFFF'
        const border = st === 'hold' ? '1px dashed #7C4DFF' : st === 'occupied' ? '1px solid rgba(20,8,31,.20)' : '1px solid #C9B6FF'
        return { ...base, background: bg, border, borderRadius: 4, zIndex: 10, ...selRing }
      }
      case 'walkway':
        return {
          ...base, background: '#F4F1F8', border: '1px solid rgba(20,8,31,.06)', zIndex: 1,
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(91,43,201,.20) 0 6px, transparent 6px 14px)',
          backgroundSize: '100% 2px', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', ...selRing,
        }
      case 'staircase':
        return { ...base, background: 'repeating-linear-gradient(0deg, #E4DEF2 0 6px, #D3CAE8 6px 8px)', border: '1px solid rgba(20,8,31,.18)', borderRadius: 3, zIndex: 5, ...selRing }
      case 'lift':
        return { ...base, background: '#E8DEFF', border: '1.5px solid #A78BFA', borderRadius: 4, zIndex: 5, ...selRing }
      case 'entrance':
        return { ...base, background: '#CDEBD8', border: '1px solid #6FBF8E', borderRadius: 3, zIndex: 5, ...selRing }
      case 'office':
        return { ...base, background: '#F6EDDA', border: '1px solid rgba(20,8,31,.16)', borderRadius: 4, zIndex: 5, ...selRing }
      case 'toilet':
        return { ...base, background: '#DCEFF7', border: '1px solid #86BEDB', borderRadius: 4, zIndex: 5, ...selRing }
      case 'loading':
        return { ...base, background: '#FFE8D2', border: '1px dashed #DE9A5A', borderRadius: 4, zIndex: 5, ...selRing }
      case 'wall':
        return { ...base, background: '#14081F', borderRadius: 2, zIndex: 20, ...selRing }
      case 'column':
        return { ...base, background: '#4A4357', borderRadius: '50%', zIndex: 20, ...selRing }
      case 'label':
        return { ...base, background: 'transparent', zIndex: 25, justifyContent: 'flex-start', alignItems: 'flex-start', ...selRing }
    }
  }

  const NONUNIT_LABEL: Partial<Record<ShapeType, string>> = {
    staircase: 'Stairs', lift: 'Lift', entrance: 'Entrance', office: 'Office', toilet: 'WC', loading: 'Loading',
  }

  // ── Field update handlers (single selection) ────────────────────────────
  const setSingleField = (patch: Partial<Shape>) => {
    pushUndoField()
    updateSelShapes(s => ({ ...s, ...patch }))
  }
  const setSingleDim = (key: 'x' | 'y' | 'w' | 'h', disp: number) => {
    if (!floor || isNaN(disp)) return
    pushUndoField()
    const v = Math.max(key === 'w' || key === 'h' ? 0.3 : 0, round2(fromDisp(disp, floor.system)))
    updateSelShapes(s => ({ ...s, [key]: v }))
  }

  // Set unit area in sqft directly — scales W/D keeping the current proportions
  const setSingleArea = (sqft: number) => {
    if (isNaN(sqft) || sqft <= 0) return
    pushUndoField()
    updateSelShapes(s => {
      const targetM2 = sqft / SQM2SQFT
      const ratio = s.w / s.h || 1
      const h = Math.sqrt(targetM2 / ratio)
      const w = targetM2 / h
      return { ...s, w: round2(w), h: round2(h) }
    })
  }

  const setFloorField = (patch: Partial<Floor>) => {
    pushUndoField()
    updateFloor(f => ({ ...f, ...patch }))
  }

  // Status action from view panel
  const setUnitStatus = (st: UnitStatus) => {
    pushUndo()
    updateSelShapes(s => ({ ...s, status: st }))
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (!doc || !floor) return <div className="flex justify-center py-20"><Spinner /></div>

  const similar = single && mode === 'view'
    ? units.filter(u => u.id !== single.id && u.status === 'available' && sizeClass(areaSqft(u)).cls === sizeClass(areaSqft(single)).cls).slice(0, 3)
    : []

  const isEdit = mode === 'edit'
  const showViewEmpty = mode === 'view' && !single
  const showUnitPanel = mode === 'view' && !!single && single.type === 'unit'
  const showInspector = isEdit && selShapes.length > 0
  const showSettings = isEdit && selShapes.length === 0

  return (
    <div style={{ minHeight: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', background: '#FBF8F2' }}>

      {/* ── Header bar ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap" style={{ padding: '14px 24px', borderBottom: '1px solid rgba(20,8,31,.10)', background: '#fff' }}>
        <div className="flex items-center gap-3">
          <h1 style={{ ...HEADING, fontWeight: 700, fontSize: 19, margin: 0 }}>Floor Map</h1>
          <span style={{ width: 1, height: 22, background: 'rgba(20,8,31,.12)' }} />
          <input
            type="text" value={doc.facilityName}
            onChange={e => { pushUndoField(); setDoc(d => d ? { ...d, facilityName: e.target.value } : d) }}
            className="rounded-lg px-2 py-1 hover:bg-muted/40 focus:bg-white focus:border-[#5B2BC9]"
            style={{ border: '1px solid transparent', background: 'transparent', fontSize: 14.5, fontWeight: 600, color: '#4A4357', width: 220, outline: 'none' }}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1" style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', borderRadius: 999 }}>
            <button type="button" onClick={() => { setMode('view'); setTool(null); setSel([]) }} style={pill(mode === 'view')}>Availability</button>
            <button type="button" onClick={() => { setMode('edit'); setSel([]) }} style={pill(mode === 'edit')} className="hidden md:block">Edit layout</button>
          </div>
          <button type="button" onClick={saveToSystem} disabled={saveMut.isPending}
            className="h-9 px-4 rounded-full text-[13px] font-bold cursor-pointer text-white hover:opacity-90 disabled:opacity-60"
            style={{ background: PURPLE, border: 'none' }}>
            {saveMut.isPending ? 'Saving…' : 'Save to system'}
          </button>
          <span style={{ fontSize: 12.5, color: MUTED, whiteSpace: 'nowrap' }}>{saveState}</span>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap" style={{ padding: '10px 24px', borderBottom: '1px solid rgba(20,8,31,.10)', background: '#fff' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 p-1" style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', borderRadius: 999 }}>
            {doc.floors.map((f, i) => (
              <button key={f.id} type="button" onClick={() => { setFloorIdx(i); setSel([]) }} style={pill(i === floorIdx)}>
                {f.name}<span style={{ opacity: .6, marginLeft: 6 }}>{f.shapes.filter(s => s.type === 'unit').length}</span>
              </button>
            ))}
          </div>
          {isEdit && <button type="button" onClick={addFloor} className={ghostBtn} style={ghostBtnStyle}>+ Floor</button>}
        </div>

        {mode === 'view' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2" style={{ height: 34, padding: '0 14px', border: '1px solid rgba(20,8,31,.16)', borderRadius: 999, background: '#fff' }}>
              <span style={{ fontSize: 13, color: MUTED }}>Unit</span>
              <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="F1-12"
                style={{ border: 0, outline: 'none', width: 70, fontSize: 13, fontWeight: 600, color: INK, background: 'transparent' }} />
            </div>
            <button type="button" onClick={() => setFilter('all')} style={filterPill(filter === 'all')}>All</button>
            <button type="button" onClick={() => setFilter('available')} style={filterPill(filter === 'available')}>Available <span style={{ opacity: .6, marginLeft: 5 }}>{availCount}</span></button>
            <button type="button" onClick={() => setFilter('hold')} style={filterPill(filter === 'hold')}>On hold <span style={{ opacity: .6, marginLeft: 5 }}>{holdCount}</span></button>
            <button type="button" onClick={() => setFilter('occupied')} style={filterPill(filter === 'occupied')}>Occupied <span style={{ opacity: .6, marginLeft: 5 }}>{occCount}</span></button>
            <select value={sizeF ?? ''} onChange={e => setSizeF(e.target.value ? parseInt(e.target.value) : null)}
              style={{ ...filterPill(sizeF != null), paddingRight: 10 }} className="cursor-pointer">
              <option value="">All sizes</option>
              {[25, 35, 50, 75, 100, 150, 200].map(s => <option key={s} value={s}>{s} sqft</option>)}
            </select>
          </div>
        )}

        {isEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={undo} title="Undo (Ctrl+Z)" className={ghostBtn} style={ghostBtnStyle}>Undo</button>
            <button type="button" onClick={redo} title="Redo (Ctrl+Shift+Z)" className={ghostBtn} style={ghostBtnStyle}>Redo</button>
            <span style={{ width: 1, height: 22, background: 'rgba(20,8,31,.12)' }} />
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ fontSize: 12.5, color: '#4A4357', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={snapOn} onChange={e => setSnapOn(e.target.checked)} style={{ accentColor: PURPLE, width: 15, height: 15 }} />
              Snap to neighbours
            </label>
            <select value={String(grid)} onChange={e => setGrid(parseFloat(e.target.value))} className="h-8 rounded-lg border px-2 text-[12.5px]" style={ghostBtnStyle}>
              <option value="0.1">Grid 10 cm</option>
              <option value="0.25">Grid 25 cm</option>
              <option value="0.5">Grid 50 cm</option>
              <option value="1">Grid 1 m</option>
            </select>
            <span style={{ width: 1, height: 22, background: 'rgba(20,8,31,.12)' }} />
            <button type="button" onClick={exportFile} className={ghostBtn} style={ghostBtnStyle}>Export</button>
            <button type="button" onClick={() => importRef.current?.click()} className={ghostBtn} style={ghostBtnStyle}>Import</button>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex items-stretch flex-1 min-h-0">

        {/* Palette (edit mode) */}
        {isEdit && (
          <div className="hidden md:block" style={{ width: 178, flex: '0 0 178px', borderRight: '1px solid rgba(20,8,31,.10)', background: '#fff', padding: '18px 14px', overflow: 'auto' }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>Place</p>
            <div className="grid gap-1.5">
              {PALETTE.map(p => (
                <button key={p.type} type="button" onClick={() => setTool(t => t === p.type ? null : p.type)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium cursor-pointer transition-colors text-left"
                  style={{
                    border: tool === p.type ? `1.5px solid ${PURPLE}` : '1px solid rgba(20,8,31,.10)',
                    background: tool === p.type ? '#F7F3FF' : '#fff',
                    color: tool === p.type ? '#4A1FA0' : '#4A4357',
                  }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, background: p.color, border: p.type === 'label' ? '1px dashed rgba(20,8,31,.3)' : '1px solid rgba(20,8,31,.18)' }} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>

            <p style={{ margin: '18px 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>Row builder</p>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: MUTED, lineHeight: 1.5 }}>Select a unit, then repeat it along its row.</p>
            <div className="flex items-center gap-1.5">
              <input type="number" value={repeatN} min={1} max={40} onChange={e => setRepeatN(Math.max(1, Math.min(40, parseInt(e.target.value) || 1)))}
                className="h-8 w-14 rounded-lg border px-2 text-[13px]" style={fieldStyle} />
              <button type="button" onClick={doRepeat}
                className="h-8 px-3 rounded-lg text-[12.5px] font-semibold cursor-pointer text-white hover:opacity-90"
                style={{ background: PURPLE, border: 'none' }}>Repeat →</button>
            </div>

            <p style={{ margin: '18px 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>Trace a drawing</p>
            <button type="button" onClick={() => bgRef.current?.click()} className={`${ghostBtn} w-full`} style={ghostBtnStyle}>
              {floor.bgImage ? 'Replace image' : 'Upload image'}
            </button>
            {floor.bgImage && (
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: '0 0 6px', fontSize: 12, color: MUTED }}>Opacity</p>
                <input type="range" min={5} max={100} value={floor.bgOpacity}
                  onChange={e => setFloorField({ bgOpacity: parseInt(e.target.value) })}
                  style={{ width: '100%', accentColor: PURPLE }} />
                <button type="button" onClick={() => setFloorField({ bgImage: null })} className={`${ghostBtn} w-full mt-2`} style={ghostBtnStyle}>Remove image</button>
              </div>
            )}
          </div>
        )}

        {/* Canvas */}
        <main className="flex-1 min-w-0 flex flex-col gap-3.5" style={{ padding: '20px 24px 24px' }}>
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <h2 style={{ ...HEADING, fontWeight: 700, fontSize: 26, margin: 0 }}>{floor.name}</h2>
              <p style={{ margin: '5px 0 0', fontSize: 13, color: MUTED }}>
                {units.length} units
              </p>
            </div>
            <div className="flex items-center flex-wrap gap-x-4 gap-y-2">
              <span className="flex items-center gap-2" style={{ fontSize: 12.5, color: '#4A4357' }}><span style={{ width: 14, height: 14, borderRadius: 3, background: '#fff', border: '1px solid #C9B6FF' }} />Available</span>
              <span className="flex items-center gap-2" style={{ fontSize: 12.5, color: '#4A4357' }}><span style={{ width: 14, height: 14, borderRadius: 3, background: '#EDE5FF', border: '1px dashed #7C4DFF' }} />On hold</span>
              <span className="flex items-center gap-2" style={{ fontSize: 12.5, color: '#4A4357' }}><span style={{ width: 14, height: 14, borderRadius: 3, background: '#EDE3CF', border: '1px solid rgba(20,8,31,.16)' }} />Occupied</span>
              <span className="flex items-center gap-2" style={{ fontSize: 12.5, color: '#4A4357' }}><span style={{ width: 14, height: 14, borderRadius: 3, background: '#F4F1F8', border: '1px solid rgba(20,8,31,.10)' }} />Walkway</span>
            </div>
          </div>

          <div style={{ position: 'relative', flex: 1, minHeight: 420, display: 'flex', flexDirection: 'column' }}>
            <div
              ref={canvasWrapRef}
              style={{
                flex: 1, minHeight: 420, overflow: 'auto', borderRadius: 16,
                border: '1px solid rgba(20,8,31,.12)', background: '#EFEBF5',
                cursor: tool ? 'crosshair' : 'default',
              }}>
              <div style={{ padding: 24, display: 'inline-block' }}>
              <div
                ref={planRef}
                data-plan="1"
                onMouseDown={onCanvasDown}
                style={{
                  position: 'relative',
                  width: floor.width * zoom,
                  height: floor.depth * zoom,
                  background: '#FBF9FE',
                  border: '2px solid rgba(20,8,31,.35)',
                  backgroundImage: 'linear-gradient(rgba(91,43,201,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(91,43,201,.06) 1px, transparent 1px)',
                  backgroundSize: `${grid * zoom}px ${grid * zoom}px`,
                }}>
                {floor.bgImage && (
                  <img src={floor.bgImage} alt="" draggable={false}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', opacity: floor.bgOpacity / 100, pointerEvents: 'none' }} />
                )}

                {floor.shapes.map(s => {
                  const showNum = s.type === 'unit' && s.w * zoom > 30
                  const showSize = s.type === 'unit' && s.w * zoom > 46 && s.h * zoom > 40
                  return (
                    <div key={s.id} onMouseDown={e => onShapeDown(e, s)} style={shapeStyle(s)}
                      title={s.type === 'unit' ? `${s.num} · ${fmtArea(s)} · ${s.status}` : PALETTE.find(p => p.type === s.type)?.name}>
                      {s.type === 'unit' && showNum && (
                        <span style={{ fontSize: Math.min(12, s.w * zoom / 5), fontWeight: 700, color: INK, lineHeight: 1 }}>{s.num}</span>
                      )}
                      {showSize && (
                        <span style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{Math.round(areaSqft(s))} sqft</span>
                      )}
                      {s.type === 'label' && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#4A4357', padding: 2, whiteSpace: 'nowrap' }}>{s.text}</span>
                      )}
                      {NONUNIT_LABEL[s.type] && s.w * zoom > 28 && s.h * zoom > 16 && (
                        <span style={{ fontSize: 9.5, fontWeight: 600, color: '#4A4357', letterSpacing: '0.04em' }}>{NONUNIT_LABEL[s.type]}</span>
                      )}
                    </div>
                  )
                })}

                {/* Resize handles for single selection */}
                {isEdit && single && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(dir => {
                  const fx = dir.includes('w') ? 0 : dir.includes('e') ? 1 : 0.5
                  const fy = dir.includes('n') ? 0 : dir.includes('s') ? 1 : 0.5
                  return (
                    <div key={dir}
                      onMouseDown={e => { e.stopPropagation(); beginDrag('resize', e, dir) }}
                      style={{
                        position: 'absolute',
                        left: (single.x + fx * single.w) * zoom - 5,
                        top: (single.y + fy * single.h) * zoom - 5,
                        width: 10, height: 10, background: '#fff',
                        border: `2px solid ${PURPLE}`, borderRadius: 3, zIndex: 40,
                        cursor: `${dir}-resize`,
                      }} />
                  )
                })}

                {marquee && (
                  <div style={{
                    position: 'absolute', left: marquee.x * zoom, top: marquee.y * zoom,
                    width: marquee.w * zoom, height: marquee.h * zoom,
                    border: `1.5px dashed ${PURPLE}`, background: 'rgba(91,43,201,.07)', zIndex: 50, pointerEvents: 'none',
                  }} />
                )}
              </div>
            </div>
            </div>

            {/* Floating zoom controls — both modes */}
            <div className="flex items-center gap-1" style={{
              position: 'absolute', right: 12, bottom: 12, zIndex: 60,
              background: '#fff', border: '1px solid rgba(20,8,31,.14)', borderRadius: 999,
              padding: 4, boxShadow: '0 4px 14px rgba(20,8,31,.12)',
            }}>
              <button type="button" onClick={() => setZoom(z => Math.max(4, round2(z / 1.25)))} title="Zoom out"
                className="h-8 w-8 rounded-full cursor-pointer hover:bg-muted/50 font-bold" style={{ border: 'none', background: 'transparent', color: '#4A4357', fontSize: 16 }}>−</button>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#4A4357', minWidth: 40, textAlign: 'center' }}>{Math.round(zoom / 16 * 100)}%</span>
              <button type="button" onClick={() => setZoom(z => Math.min(60, round2(z * 1.25)))} title="Zoom in"
                className="h-8 w-8 rounded-full cursor-pointer hover:bg-muted/50 font-bold" style={{ border: 'none', background: 'transparent', color: '#4A4357', fontSize: 16 }}>+</button>
              <span style={{ width: 1, height: 18, background: 'rgba(20,8,31,.12)' }} />
              <button type="button" onClick={fitZoom} title="Fit floor to screen"
                className="h-8 px-3 rounded-full cursor-pointer hover:bg-muted/50" style={{ border: 'none', background: 'transparent', color: '#4A4357', fontSize: 12, fontWeight: 700 }}>Fit</button>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
            {isEdit
              ? 'Pick a tool then click the plan to place it · drag to move · drag handles to resize · Shift-click or drag empty space to multi-select · arrows nudge · Ctrl+Z undo · autosaves in this browser'
              : 'Click any unit for details. Use search and filters above to narrow down.'}
          </p>
        </main>

        {/* Right panel */}
        <aside className="hidden lg:flex" style={{ width: 340, flex: '0 0 340px', borderLeft: '1px solid rgba(20,8,31,.10)', background: '#fff', padding: '22px 22px 30px', flexDirection: 'column', gap: 18, overflow: 'auto' }}>

          {/* View mode — nothing selected */}
          {showViewEmpty && (
            <div className="flex flex-col gap-3.5 items-start" style={{ paddingTop: 20 }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: '#F7F3FF', border: '1px solid #EDE5FF', position: 'relative', display: 'block' }}>
                <span style={{ position: 'absolute', inset: 12, border: '2px solid #A78BFA', borderRadius: 3, display: 'block' }} />
              </span>
              <h2 style={{ ...HEADING, fontSize: 21, fontWeight: 700, margin: 0 }}>Select a unit</h2>
              <p style={{ margin: 0, fontSize: 14, color: '#4A4357', lineHeight: 1.55 }}>Click any unit on the plan to see its size, rate and status — then place it on hold for a customer.</p>
              <div className="w-full grid gap-2.5" style={{ marginTop: 6, borderTop: '1px solid rgba(20,8,31,.10)', paddingTop: 16 }}>
                <div className="flex items-baseline justify-between"><span style={{ fontSize: 13, color: MUTED }}>Units on this floor</span><span style={{ fontSize: 15, fontWeight: 700 }}>{units.length}</span></div>
                <div className="flex items-baseline justify-between"><span style={{ fontSize: 13, color: MUTED }}>Available now</span><span style={{ fontSize: 15, fontWeight: 700, color: '#4A1FA0' }}>{availCount}</span></div>
                <div className="flex items-baseline justify-between"><span style={{ fontSize: 13, color: MUTED }}>Size range</span><span style={{ fontSize: 15, fontWeight: 700 }}>{sizeRange}</span></div>
                <div className="flex items-baseline justify-between"><span style={{ fontSize: 13, color: MUTED }}>Lettable area</span><span style={{ fontSize: 15, fontWeight: 700 }}>{Math.round(lettableSqft).toLocaleString()} sqft</span></div>
              </div>
            </div>
          )}

          {/* View mode — unit selected */}
          {showUnitPanel && single && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start justify-between gap-3.5">
                <div>
                  <p style={{ margin: '0 0 5px', fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>{floor.name} · Storage unit</p>
                  <h2 style={{ ...HEADING, fontSize: 34, fontWeight: 700, margin: 0, lineHeight: 1 }}>{single.num}</h2>
                </div>
                <span style={{
                  padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
                  background: single.status === 'available' ? '#EAF7EF' : single.status === 'hold' ? '#F7F3FF' : '#F4EDE0',
                  color: single.status === 'available' ? '#1D7A45' : single.status === 'hold' ? '#4A1FA0' : '#8A6A2F',
                }}>
                  {single.status === 'available' ? 'Available' : single.status === 'hold' ? 'On hold' : 'Occupied'}
                </span>
              </div>

              <div className="grid grid-cols-2" style={{ gap: 1, background: 'rgba(20,8,31,.10)', border: '1px solid rgba(20,8,31,.10)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ background: '#fff', padding: '15px 17px' }}>
                  <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Area</p>
                  <p style={{ ...HEADING, margin: '4px 0 0', fontSize: 22, fontWeight: 700 }}>{fmtArea(single)}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: MUTED }}>{fmtAreaAlt(single)}</p>
                </div>
                <div style={{ background: '#fff', padding: '15px 17px' }}>
                  <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Footprint</p>
                  <p style={{ ...HEADING, margin: '4px 0 0', fontSize: 22, fontWeight: 700 }}>{fmtDim(single.w)} × {fmtDim(single.h)}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: MUTED }}>{dimUnit}, as drawn</p>
                </div>
                <div style={{ background: '#fff', padding: '15px 17px' }}>
                  <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Rate</p>
                  <p style={{ ...HEADING, margin: '4px 0 0', fontSize: 22, fontWeight: 700 }}>{unitPrice(single).toLocaleString()}<span style={{ fontSize: 12, fontWeight: 500, color: MUTED, marginLeft: 4 }}>/ mo</span></p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: MUTED }}>AED, ex. VAT</p>
                </div>
                <div style={{ background: '#fff', padding: '15px 17px' }}>
                  <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Size class</p>
                  <p style={{ ...HEADING, margin: '4px 0 0', fontSize: 22, fontWeight: 700 }}>{sizeClass(areaSqft(single)).cls}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: MUTED }}>fits {sizeClass(areaSqft(single)).fits}</p>
                </div>
              </div>

              <label className="grid gap-1">
                <span style={{ fontSize: 12, color: MUTED }}>Rate (AED / 4 weeks) — saves to the unit record</span>
                <input key={`vrate-${single.id}`} type="number" step="1" min="0" defaultValue={unitPrice(single) || ''}
                  onBlur={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== unitPrice(single)) commitRate(single, e.target.value) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className={fieldCls} style={fieldStyle} />
              </label>

              <div className="grid gap-2">
                {single.status === 'available' && (<>
                  <button type="button" onClick={() => navigate(`/quotes/new?unit=${encodeURIComponent(single.num ?? '')}`)}
                    className="h-11 rounded-xl text-white text-[14px] font-bold cursor-pointer hover:opacity-90" style={{ background: PURPLE, border: 'none' }}>Book this unit →</button>
                  <button type="button" onClick={() => setUnitStatus('hold')} className={`${ghostBtn} !h-10 !rounded-xl`} style={ghostBtnStyle}>Place on hold</button>
                  <button type="button" onClick={() => setUnitStatus('occupied')} className={`${ghostBtn} !h-10 !rounded-xl`} style={ghostBtnStyle}>Mark occupied</button>
                </>)}
                {single.status === 'hold' && (<>
                  <button type="button" onClick={() => navigate(`/quotes/new?unit=${encodeURIComponent(single.num ?? '')}`)}
                    className="h-11 rounded-xl text-white text-[14px] font-bold cursor-pointer hover:opacity-90" style={{ background: PURPLE, border: 'none' }}>Book this unit →</button>
                  <button type="button" onClick={() => setUnitStatus('occupied')} className={`${ghostBtn} !h-10 !rounded-xl`} style={ghostBtnStyle}>Mark occupied</button>
                  <button type="button" onClick={() => setUnitStatus('available')} className={`${ghostBtn} !h-10 !rounded-xl`} style={ghostBtnStyle}>Release hold</button>
                </>)}
                {single.status === 'occupied' && (<>
                  <button type="button" onClick={() => setUnitStatus('available')} className={`${ghostBtn} !h-10 !rounded-xl`} style={ghostBtnStyle}>Mark available</button>
                  <button type="button" onClick={() => setUnitStatus('hold')} className={`${ghostBtn} !h-10 !rounded-xl`} style={ghostBtnStyle}>Place on hold</button>
                </>)}
              </div>

              {/* Who booked it — from live contracts */}
              {(() => {
                const occ = occupancy[single.num ?? '']
                if (!occ) return null
                return (
                  <div style={{ borderTop: '1px solid rgba(20,8,31,.10)', paddingTop: 16 }}>
                    <p style={{ margin: '0 0 11px', fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>Booked by</p>
                    <div className="grid gap-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span style={{ fontSize: 13, color: MUTED }}>Customer</span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, textAlign: 'right' }}>{occ.customerName || '—'}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span style={{ fontSize: 13, color: MUTED }}>Contract</span>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{occ.contractNo}{occ.status === 'pending_signature' ? ' · pending signature' : ''}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span style={{ fontSize: 13, color: MUTED }}>Period</span>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                          {new Date(occ.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })} → {new Date(occ.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </span>
                      </div>
                      <button type="button" onClick={() => navigate(`/contracts/${occ.contractId}`)}
                        className={`${ghostBtn} !h-10 !rounded-xl w-full mt-1`} style={ghostBtnStyle}>Open contract →</button>
                    </div>
                  </div>
                )
              })()}

              {similar.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(20,8,31,.10)', paddingTop: 16 }}>
                  <p style={{ margin: '0 0 11px', fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>Similar &amp; available</p>
                  <div className="flex flex-wrap gap-2">
                    {similar.map(s => (
                      <button key={s.id} type="button" onClick={() => setSel([s.id])}
                        className="flex items-center gap-2 cursor-pointer hover:opacity-80"
                        style={{ height: 33, padding: '0 13px', border: '1px solid #EDE5FF', borderRadius: 999, background: '#F7F3FF', color: '#4A1FA0', fontSize: 13, fontWeight: 600 }}>
                        {s.num}<span style={{ fontWeight: 500, opacity: .7 }}>{Math.round(areaSqft(s))} sqft</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Edit mode — inspector */}
          {showInspector && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 style={{ ...HEADING, fontSize: 21, fontWeight: 700, margin: 0 }}>
                  {single ? (single.type === 'unit' ? `Unit ${single.num}` : PALETTE.find(p => p.type === single.type)?.name) : `${selShapes.length} selected`}
                </h2>
                <button type="button"
                  onClick={() => { pushUndo(); const ids = new Set(sel); updateShapes(shapes => shapes.filter(s => !ids.has(s.id))); setSel([]) }}
                  className="h-8 px-3 rounded-full text-[12.5px] font-semibold cursor-pointer hover:opacity-80"
                  style={{ background: '#FDECEC', color: '#B3261E', border: '1px solid #F5C9C6' }}>Delete</button>
              </div>

              {single && (
                <div className="grid gap-3.5">
                  {single.type === 'unit' && (
                    <>
                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="grid gap-1">
                          <span style={{ fontSize: 12, color: MUTED }}>Unit number</span>
                          <input type="text" value={single.num ?? ''} onChange={e => setSingleField({ num: e.target.value })} className={fieldCls} style={fieldStyle} />
                        </label>
                        <label className="grid gap-1">
                          <span style={{ fontSize: 12, color: MUTED }}>Status</span>
                          <select value={single.status ?? 'available'} onChange={e => setSingleField({ status: e.target.value as UnitStatus })} className={fieldCls} style={fieldStyle}>
                            <option value="available">Available</option>
                            <option value="hold">On hold</option>
                            <option value="occupied">Occupied</option>
                          </select>
                        </label>
                      </div>
                      <label className="grid gap-1">
                        <span style={{ fontSize: 12, color: MUTED }}>Rate (AED / 4 weeks) — saves to the unit record</span>
                        <input key={`rate-${single.id}`} type="number" step="1" min="0" defaultValue={unitPrice(single) || ''}
                          onBlur={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== unitPrice(single)) commitRate(single, e.target.value) }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          className={fieldCls} style={fieldStyle} />
                      </label>
                    </>
                  )}

                  <label className="grid gap-1">
                    <span style={{ fontSize: 12, color: MUTED }}>Area (sqft) — resizes it, keeps proportions</span>
                    <input type="number" step="1" min="1" value={Math.round(areaSqft(single))} onChange={e => setSingleArea(parseFloat(e.target.value))} className={fieldCls} style={fieldStyle} />
                  </label>
                  {single.type === 'label' && (
                    <label className="grid gap-1">
                      <span style={{ fontSize: 12, color: MUTED }}>Text</span>
                      <input type="text" value={single.text ?? ''} onChange={e => setSingleField({ text: e.target.value })} className={fieldCls} style={fieldStyle} />
                    </label>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="grid gap-1">
                      <span style={{ fontSize: 12, color: MUTED }}>Width ({dimUnit})</span>
                      <input type="number" step="0.05" value={fmtDim(single.w)} onChange={e => setSingleDim('w', parseFloat(e.target.value))} className={fieldCls} style={fieldStyle} />
                    </label>
                    <label className="grid gap-1">
                      <span style={{ fontSize: 12, color: MUTED }}>Depth ({dimUnit})</span>
                      <input type="number" step="0.05" value={fmtDim(single.h)} onChange={e => setSingleDim('h', parseFloat(e.target.value))} className={fieldCls} style={fieldStyle} />
                    </label>
                    <label className="grid gap-1">
                      <span style={{ fontSize: 12, color: MUTED }}>X ({dimUnit})</span>
                      <input type="number" step="0.05" value={fmtDim(single.x)} onChange={e => setSingleDim('x', parseFloat(e.target.value))} className={fieldCls} style={fieldStyle} />
                    </label>
                    <label className="grid gap-1">
                      <span style={{ fontSize: 12, color: MUTED }}>Y ({dimUnit})</span>
                      <input type="number" step="0.05" value={fmtDim(single.y)} onChange={e => setSingleDim('y', parseFloat(e.target.value))} className={fieldCls} style={fieldStyle} />
                    </label>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={rotateSel} className={ghostBtn} style={ghostBtnStyle}>Rotate 90°</button>
                    <button type="button" onClick={duplicateSel} className={ghostBtn} style={ghostBtnStyle}>Duplicate</button>
                  </div>

                  {single.type === 'unit' && (
                    <div className="grid gap-2" style={{ borderTop: '1px solid rgba(20,8,31,.10)', paddingTop: 14 }}>
                      <div className="flex items-baseline justify-between"><span style={{ fontSize: 13, color: MUTED }}>Area</span><span style={{ fontSize: 14, fontWeight: 700 }}>{fmtArea(single)}</span></div>
                      <div className="flex items-baseline justify-between"><span style={{ fontSize: 13, color: MUTED }}>Computed rate</span><span style={{ fontSize: 14, fontWeight: 700 }}>AED {unitPrice(single).toLocaleString()} / mo</span></div>
                    </div>
                  )}
                </div>
              )}

              {!single && (
                <div className="grid gap-3">
                  <p style={{ margin: 0, fontSize: 13.5, color: '#4A4357', lineHeight: 1.55 }}>Drag to move them together, or use the arrow keys. Delete removes all {selShapes.length}.</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={alignLeft} className={ghostBtn} style={ghostBtnStyle}>Align left</button>
                    <button type="button" onClick={alignTop} className={ghostBtn} style={ghostBtnStyle}>Align top</button>
                    <button type="button" onClick={distributeRow} className={ghostBtn} style={ghostBtnStyle}>Space evenly</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Edit mode — floor settings */}
          {showSettings && (
            <div className="flex flex-col gap-4">
              <h2 style={{ ...HEADING, fontSize: 21, fontWeight: 700, margin: 0 }}>Floor &amp; pricing</h2>
              <p style={{ margin: 0, fontSize: 13.5, color: '#4A4357', lineHeight: 1.55 }}>Pick a tool on the left and click the plan to place it. Click anything to select, drag to move, drag a handle to resize.</p>

              <div className="grid gap-2.5">
                <label className="grid gap-1">
                  <span style={{ fontSize: 12, color: MUTED }}>Floor name</span>
                  <input type="text" value={floor.name} onChange={e => setFloorField({ name: e.target.value })} className={fieldCls} style={fieldStyle} />
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="grid gap-1">
                    <span style={{ fontSize: 12, color: MUTED }}>Unit prefix</span>
                    <input type="text" value={floor.prefix} onChange={e => setFloorField({ prefix: e.target.value })} className={fieldCls} style={fieldStyle} />
                  </label>
                  <label className="grid gap-1">
                    <span style={{ fontSize: 12, color: MUTED }}>Rate / sqft / mo</span>
                    <input type="number" step="0.5" value={floor.rate} onChange={e => setFloorField({ rate: parseFloat(e.target.value) || 0 })} className={fieldCls} style={fieldStyle} />
                  </label>
                  <label className="grid gap-1">
                    <span style={{ fontSize: 12, color: MUTED }}>Floor width ({dimUnit})</span>
                    <input type="number" step="0.5" value={fmtDim(floor.width)} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 2) setFloorField({ width: round2(fromDisp(v, floor.system)) }) }} className={fieldCls} style={fieldStyle} />
                  </label>
                  <label className="grid gap-1">
                    <span style={{ fontSize: 12, color: MUTED }}>Floor depth ({dimUnit})</span>
                    <input type="number" step="0.5" value={fmtDim(floor.depth)} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 2) setFloorField({ depth: round2(fromDisp(v, floor.system)) }) }} className={fieldCls} style={fieldStyle} />
                  </label>
                </div>
                <label className="grid gap-1">
                  <span style={{ fontSize: 12, color: MUTED }}>Measurements</span>
                  <select value={floor.system} onChange={e => setFloorField({ system: e.target.value as 'metric' | 'imperial' })} className={fieldCls} style={fieldStyle}>
                    <option value="metric">Metric — metres, m²</option>
                    <option value="imperial">Imperial — feet, sqft</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-2" style={{ borderTop: '1px solid rgba(20,8,31,.10)', paddingTop: 14 }}>
                <div className="flex items-baseline justify-between"><span style={{ fontSize: 13, color: MUTED }}>Units on this floor</span><span style={{ fontSize: 14, fontWeight: 700 }}>{units.length}</span></div>
                <div className="flex items-baseline justify-between"><span style={{ fontSize: 13, color: MUTED }}>Lettable area</span><span style={{ fontSize: 14, fontWeight: 700 }}>{Math.round(lettableSqft).toLocaleString()} sqft</span></div>
                <div className="flex items-baseline justify-between"><span style={{ fontSize: 13, color: MUTED }}>Potential revenue</span><span style={{ fontSize: 14, fontWeight: 700 }}>AED {potentialRevenue.toLocaleString()} / mo</span></div>
              </div>

              <div className="grid gap-2" style={{ borderTop: '1px solid rgba(20,8,31,.10)', paddingTop: 14 }}>
                <button type="button" onClick={clearFloor} className={`${ghostBtn} w-full`} style={ghostBtnStyle}>Clear this floor</button>
                <button type="button" onClick={resetAll} className={`${ghostBtn} w-full`} style={ghostBtnStyle}>Reset from live units data</button>
                <button type="button" onClick={deleteFloor} className="h-8 w-full rounded-full text-[12.5px] font-semibold cursor-pointer hover:opacity-80" style={{ background: '#FDECEC', color: '#B3261E', border: '1px solid #F5C9C6' }}>Delete this floor</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <input type="file" accept="application/json" ref={importRef} onChange={onImport} style={{ display: 'none' }} />
      <input type="file" accept="image/*" ref={bgRef} onChange={onBgFile} style={{ display: 'none' }} />
    </div>
  )
}
