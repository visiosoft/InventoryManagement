/**
 * A street traffic light: one housing, three lamps, only one lit. Drawn in
 * SVG so it stays sharp at any size; the lit lamp glows and breathes slowly
 * (still for anybody who has asked for reduced motion).
 */

export type Signal = 'green' | 'amber' | 'red'

const LAMPS: { key: Signal; cy: number; on: string; core: string; off: string }[] = [
  { key: 'red', cy: 62, on: '#FF3B30', core: '#FFD4D0', off: '#3A1715' },
  { key: 'amber', cy: 132, on: '#FF9F0A', core: '#FFE9C2', off: '#3A2A10' },
  { key: 'green', cy: 202, on: '#30D158', core: '#D2FFDD', off: '#11301A' },
]

export default function TrafficLight({ signal, size = 120 }: { signal: Signal; size?: number }) {
  const label = signal === 'green' ? 'Green light' : signal === 'amber' ? 'Amber light' : 'Red light'
  return (
    <svg viewBox="0 0 120 320" width={size * 0.6} height={size * 1.6} role="img" aria-label={label} style={{ flex: '0 0 auto', overflow: 'visible' }}>
      <style>{`
        @keyframes tl-breathe { 0%, 100% { opacity: .55 } 50% { opacity: .95 } }
        .tl-glow { animation: tl-breathe 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .tl-glow { animation: none; opacity: .8 } }
      `}</style>
      <defs>
        <linearGradient id="tl-body" x1="0" x2="1">
          <stop offset="0" stopColor="#2B3036" />
          <stop offset=".5" stopColor="#1C2025" />
          <stop offset="1" stopColor="#111418" />
        </linearGradient>
        <linearGradient id="tl-pole" x1="0" x2="1">
          <stop offset="0" stopColor="#5A6068" />
          <stop offset=".5" stopColor="#3A3F46" />
          <stop offset="1" stopColor="#24282D" />
        </linearGradient>
        {LAMPS.map((l) => (
          <radialGradient key={l.key} id={`tl-lit-${l.key}`} cx=".42" cy=".38" r=".7">
            <stop offset="0" stopColor={l.core} />
            <stop offset=".35" stopColor={l.on} />
            <stop offset="1" stopColor={l.on} stopOpacity=".85" />
          </radialGradient>
        ))}
        <radialGradient id="tl-off" cx=".4" cy=".35" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".10" />
          <stop offset="1" stopColor="#000" stopOpacity=".25" />
        </radialGradient>
        <filter id="tl-blur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="10" /></filter>
      </defs>

      {/* Pole and its base */}
      <rect x="51" y="250" width="18" height="62" fill="url(#tl-pole)" />
      <rect x="38" y="308" width="44" height="8" rx="3" fill="#2A2E33" />

      {/* Housing, with a bracket to the pole */}
      <rect x="44" y="238" width="32" height="16" rx="3" fill="#24282D" />
      <rect x="16" y="14" width="88" height="230" rx="20" fill="url(#tl-body)" stroke="#0B0D10" strokeWidth="2" />
      <rect x="22" y="20" width="10" height="218" rx="5" fill="#fff" opacity=".05" />

      {LAMPS.map((l) => {
        const lit = l.key === signal
        return (
          <g key={l.key}>
            {lit && <circle className="tl-glow" cx="60" cy={l.cy} r="34" fill={l.on} filter="url(#tl-blur)" />}
            {/* Lamp recess */}
            <circle cx="60" cy={l.cy} r="27" fill="#07080A" />
            <circle cx="60" cy={l.cy} r="23" fill={lit ? `url(#tl-lit-${l.key})` : l.off} />
            {!lit && <circle cx="60" cy={l.cy} r="23" fill="url(#tl-off)" />}
            {lit && <ellipse cx="52" cy={l.cy - 9} rx="8" ry="5" fill="#fff" opacity=".55" />}
            {/* Visor over the lamp */}
            <path d={`M30 ${l.cy - 6} Q30 ${l.cy - 34} 60 ${l.cy - 34} Q90 ${l.cy - 34} 90 ${l.cy - 6} L84 ${l.cy - 10} Q82 ${l.cy - 28} 60 ${l.cy - 28} Q38 ${l.cy - 28} 36 ${l.cy - 10} Z`} fill="#0E1013" />
          </g>
        )
      })}
    </svg>
  )
}
