import { useMemo, useRef, useState } from 'react'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

// Rough point-based estimator — there's no per-item pricing table in the
// system to derive real rates from, so these weights and the AED-per-point
// rate are reasonable defaults meant to be tuned by the business over time.
// The output is explicitly framed as a rough range, not a quote.
const RATE_PER_POINT = 25 // AED per "effort point"
const MOVE_TYPE_BASE: Record<string, number> = { Apartment: 40, Villa: 70, Office: 50 }
const BEDROOM_POINTS = 15
const SERVICE_POINTS: Record<string, number> = { None: 0, Assembly: 6, Disassembly: 6, Both: 10 }
const KITCHEN_POINTS: Record<string, number> = { Light: 5, Medium: 12, Heavy: 22 }
const CLOSET_ITEM_MULTIPLIER: Record<string, number> = { Light: 1, Medium: 1.5, Heavy: 2.2 }
const CLOSET_BASE_POINTS = 4

const ITEM_POINTS = {
  dressers: 8, singleBeds: 10, queenBeds: 14, kingBeds: 18,
  fridges: 12, stoves: 8, dishwashers: 8, washingMachines: 10,
  diningSets: 15,
  livingRoomSmall: 5, livingRoomMedium: 10, livingRoomLarge: 18,
  outdoorFurniture: 10, rugs: 3, mirrors: 4, barbecues: 8, bicyclesScooters: 6,
  customItem: 5, customAppliance: 8,
}

type ServiceLevel = 'None' | 'Assembly' | 'Disassembly' | 'Both'
type WeightLevel = 'Light' | 'Medium' | 'Heavy'

interface CustomRow { id: number; name: string; qty: number }

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ fontSize: 14, color: '#4A4357' }}>{label}</span>
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))}
          style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', background: '#fff', fontWeight: 700 }}
          className="cursor-pointer">-</button>
        <span style={{ fontSize: 14, fontWeight: 700, width: 20, textAlign: 'center' }}>{value}</span>
        <button type="button" onClick={() => onChange(value + 1)}
          style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', background: '#fff', fontWeight: 700 }}
          className="cursor-pointer">+</button>
      </div>
    </div>
  )
}

function ServiceSelect({ label, value, onChange }: { label: string; value: ServiceLevel; onChange: (v: ServiceLevel) => void }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: '#4A4357', marginBottom: 6 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value as ServiceLevel)}
        style={{ width: '100%', height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }}>
        <option value="None">None</option>
        <option value="Assembly">Assembly</option>
        <option value="Disassembly">Disassembly</option>
        <option value="Both">Both</option>
      </select>
    </div>
  )
}

export default function MovingEstimator() {
  const [moveType, setMoveType] = useState('Apartment')
  const [bedrooms, setBedrooms] = useState(1)
  const [curtains, setCurtains] = useState<ServiceLevel>('None')
  const [lightFixtures, setLightFixtures] = useState<ServiceLevel>('None')
  const [applianceAssembly, setApplianceAssembly] = useState<ServiceLevel>('None')

  const [dressers, setDressers] = useState(0)
  const [singleBeds, setSingleBeds] = useState(0)
  const [queenBeds, setQueenBeds] = useState(0)
  const [kingBeds, setKingBeds] = useState(0)
  const [fridges, setFridges] = useState(0)
  const [stoves, setStoves] = useState(0)
  const [dishwashers, setDishwashers] = useState(0)
  const [washingMachines, setWashingMachines] = useState(0)
  const [customAppliances, setCustomAppliances] = useState<CustomRow[]>([])
  const [diningSets, setDiningSets] = useState(0)
  const [livingRoomSmall, setLivingRoomSmall] = useState(0)
  const [livingRoomMedium, setLivingRoomMedium] = useState(0)
  const [livingRoomLarge, setLivingRoomLarge] = useState(0)
  const [kitchenSize, setKitchenSize] = useState<WeightLevel>('Light')
  const [closets, setClosets] = useState(0)
  const [closetItemSize, setClosetItemSize] = useState<WeightLevel>('Light')
  const [outdoorFurniture, setOutdoorFurniture] = useState(0)
  const [rugs, setRugs] = useState(0)
  const [mirrors, setMirrors] = useState(0)
  const [barbecues, setBarbecues] = useState(0)
  const [bicyclesScooters, setBicyclesScooters] = useState(0)
  const [customItems, setCustomItems] = useState<CustomRow[]>([])
  const [notes, setNotes] = useState('')

  const nextRowId = useRef(1)

  const result = useMemo(() => {
    let points = MOVE_TYPE_BASE[moveType] || 0
    points += bedrooms * BEDROOM_POINTS
    points += SERVICE_POINTS[curtains] + SERVICE_POINTS[lightFixtures] + SERVICE_POINTS[applianceAssembly]
    points += dressers * ITEM_POINTS.dressers
    points += singleBeds * ITEM_POINTS.singleBeds
    points += queenBeds * ITEM_POINTS.queenBeds
    points += kingBeds * ITEM_POINTS.kingBeds
    points += fridges * ITEM_POINTS.fridges
    points += stoves * ITEM_POINTS.stoves
    points += dishwashers * ITEM_POINTS.dishwashers
    points += washingMachines * ITEM_POINTS.washingMachines
    points += customAppliances.reduce((s, a) => s + a.qty * ITEM_POINTS.customAppliance, 0)
    points += diningSets * ITEM_POINTS.diningSets
    points += livingRoomSmall * ITEM_POINTS.livingRoomSmall
    points += livingRoomMedium * ITEM_POINTS.livingRoomMedium
    points += livingRoomLarge * ITEM_POINTS.livingRoomLarge
    points += KITCHEN_POINTS[kitchenSize]
    points += closets * CLOSET_BASE_POINTS * CLOSET_ITEM_MULTIPLIER[closetItemSize]
    points += outdoorFurniture * ITEM_POINTS.outdoorFurniture
    points += rugs * ITEM_POINTS.rugs
    points += mirrors * ITEM_POINTS.mirrors
    points += barbecues * ITEM_POINTS.barbecues
    points += bicyclesScooters * ITEM_POINTS.bicyclesScooters
    points += customItems.reduce((s, it) => s + it.qty * ITEM_POINTS.customItem, 0)

    const mid = points * RATE_PER_POINT
    const low = Math.round((mid * 0.9) / 5) * 5
    const high = Math.round((mid * 1.15) / 5) * 5
    return { low, high }
  }, [
    moveType, bedrooms, curtains, lightFixtures, applianceAssembly,
    dressers, singleBeds, queenBeds, kingBeds, fridges, stoves, dishwashers, washingMachines, customAppliances,
    diningSets, livingRoomSmall, livingRoomMedium, livingRoomLarge, kitchenSize, closets, closetItemSize,
    outdoorFurniture, rugs, mirrors, barbecues, bicyclesScooters, customItems,
  ])

  const addCustomAppliance = () => { setCustomAppliances((r) => [...r, { id: nextRowId.current++, name: '', qty: 1 }]) }
  const addCustomItem = () => { setCustomItems((r) => [...r, { id: nextRowId.current++, name: '', qty: 1 }]) }

  return (
    <div className="space-y-4">
      <div>
        <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Moving Estimator</div>
        <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>Quick rough estimate to quote a prospect on a call</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
        <div className="space-y-4">
          {/* Property */}
          <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 22 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Property</div>
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <div style={{ fontSize: 13, color: '#4A4357', marginBottom: 6 }}>Move type</div>
                <select value={moveType} onChange={(e) => setMoveType(e.target.value)}
                  style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(20,8,31,.16)', fontSize: 14 }}>
                  {Object.keys(MOVE_TYPE_BASE).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 13, color: '#4A4357', marginBottom: 6 }}>Number of bedrooms</div>
                <select value={bedrooms} onChange={(e) => setBedrooms(Number(e.target.value))}
                  style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(20,8,31,.16)', fontSize: 14 }}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Assembly & disassembly */}
          <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 22 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Assembly &amp; Disassembly Services</div>
            <div className="space-y-3.5">
              <ServiceSelect label="Curtains" value={curtains} onChange={setCurtains} />
              <ServiceSelect label="Light fixtures" value={lightFixtures} onChange={setLightFixtures} />
              <ServiceSelect label="Appliances" value={applianceAssembly} onChange={setApplianceAssembly} />
            </div>
          </div>

          {/* Furniture & items */}
          <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 22 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Furniture &amp; Items</div>
            <div className="space-y-3.5">
              <Stepper label="Dressers" value={dressers} onChange={setDressers} />
              <Stepper label="Single bed" value={singleBeds} onChange={setSingleBeds} />
              <Stepper label="Queen size bed" value={queenBeds} onChange={setQueenBeds} />
              <Stepper label="King bed" value={kingBeds} onChange={setKingBeds} />

              <div style={{ borderTop: '1px solid rgba(20,8,31,.06)', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Appliances</div>
                <div className="space-y-2.5">
                  <Stepper label="Fridge" value={fridges} onChange={setFridges} />
                  <Stepper label="Stove" value={stoves} onChange={setStoves} />
                  <Stepper label="Dishwasher" value={dishwashers} onChange={setDishwashers} />
                  <Stepper label="Washing machine" value={washingMachines} onChange={setWashingMachines} />
                  {customAppliances.map((a) => (
                    <div key={a.id} className="flex items-center gap-2">
                      <input placeholder="Appliance name" value={a.name}
                        onChange={(e) => setCustomAppliances((r) => r.map((x) => x.id === a.id ? { ...x, name: e.target.value } : x))}
                        style={{ flex: 1, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }} />
                      <input type="number" min={1} value={a.qty}
                        onChange={(e) => setCustomAppliances((r) => r.map((x) => x.id === a.id ? { ...x, qty: Number(e.target.value) || 1 } : x))}
                        style={{ width: 56, height: 32, padding: '0 8px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }} />
                      <button type="button" onClick={() => setCustomAppliances((r) => r.filter((x) => x.id !== a.id))}
                        style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #FEE2E2', background: '#fff', color: '#991B1B' }} className="cursor-pointer font-bold">×</button>
                    </div>
                  ))}
                  <button type="button" onClick={addCustomAppliance}
                    style={{ fontSize: 12.5, fontWeight: 700, color: PURPLE, background: 'none', border: 'none', padding: 0 }} className="cursor-pointer">
                    + Add extra appliance
                  </button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(20,8,31,.06)', paddingTop: 14 }}>
                <Stepper label="Dining room set(s)" value={diningSets} onChange={setDiningSets} />
              </div>

              <div style={{ borderTop: '1px solid rgba(20,8,31,.06)', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Living room furniture</div>
                <div className="space-y-2.5">
                  <Stepper label="Three small pieces" value={livingRoomSmall} onChange={setLivingRoomSmall} />
                  <Stepper label="Three medium pieces" value={livingRoomMedium} onChange={setLivingRoomMedium} />
                  <Stepper label="Three large pieces" value={livingRoomLarge} onChange={setLivingRoomLarge} />
                </div>
              </div>

              <div className="flex items-center justify-between" style={{ borderTop: '1px solid rgba(20,8,31,.06)', paddingTop: 14 }}>
                <span style={{ fontSize: 14, color: '#4A4357' }}>Kitchen items</span>
                <select value={kitchenSize} onChange={(e) => setKitchenSize(e.target.value as WeightLevel)}
                  style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }}>
                  <option value="Light">Light</option>
                  <option value="Medium">Medium</option>
                  <option value="Heavy">Heavy</option>
                </select>
              </div>

              <div style={{ borderTop: '1px solid rgba(20,8,31,.06)', paddingTop: 14 }}>
                <Stepper label="Number of closets" value={closets} onChange={setClosets} />
                <div className="flex items-center justify-between mt-2.5">
                  <span style={{ fontSize: 14, color: '#4A4357' }}>Closet item weight</span>
                  <select value={closetItemSize} onChange={(e) => setClosetItemSize(e.target.value as WeightLevel)}
                    style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }}>
                    <option value="Light">Light</option>
                    <option value="Medium">Medium</option>
                    <option value="Heavy">Heavy</option>
                  </select>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(20,8,31,.06)', paddingTop: 14 }}>
                <Stepper label="Outdoor furniture" value={outdoorFurniture} onChange={setOutdoorFurniture} />
              </div>
              <Stepper label="Rugs" value={rugs} onChange={setRugs} />
              <Stepper label="Mirrors" value={mirrors} onChange={setMirrors} />
              <Stepper label="Barbecue" value={barbecues} onChange={setBarbecues} />
              <Stepper label="Bicycles / scooters" value={bicyclesScooters} onChange={setBicyclesScooters} />

              <div style={{ borderTop: '1px solid rgba(20,8,31,.06)', paddingTop: 14 }} className="space-y-2">
                <div style={{ fontSize: 13, fontWeight: 700 }}>Extra items</div>
                {customItems.map((it) => (
                  <div key={it.id} className="flex items-center gap-2">
                    <input placeholder="Item name" value={it.name}
                      onChange={(e) => setCustomItems((r) => r.map((x) => x.id === it.id ? { ...x, name: e.target.value } : x))}
                      style={{ flex: 1, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }} />
                    <input type="number" min={1} value={it.qty}
                      onChange={(e) => setCustomItems((r) => r.map((x) => x.id === it.id ? { ...x, qty: Number(e.target.value) || 1 } : x))}
                      style={{ width: 56, height: 32, padding: '0 8px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }} />
                    <button type="button" onClick={() => setCustomItems((r) => r.filter((x) => x.id !== it.id))}
                      style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #FEE2E2', background: '#fff', color: '#991B1B' }} className="cursor-pointer font-bold">×</button>
                  </div>
                ))}
                <button type="button" onClick={addCustomItem}
                  style={{ fontSize: 12.5, fontWeight: 700, color: PURPLE, background: 'none', border: 'none', padding: 0 }} className="cursor-pointer">
                  + Add extra item
                </button>
              </div>
            </div>
          </div>

          <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 22 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
              placeholder="Add any special instructions, access notes, or details for the crew..."
              style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(20,8,31,.16)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Estimate panel */}
        <div>
          <div style={{ background: '#14081F', color: 'white', borderRadius: 16, padding: 22, position: 'sticky', top: 16 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Estimated Cost</div>
            <div style={{ ...HEADING, fontSize: 30, fontWeight: 700, marginTop: 10 }}>AED {result.low.toLocaleString()} – {result.high.toLocaleString()}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', marginTop: 10 }}>
              Rough estimate for quoting purposes. Final price confirmed after site survey.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
