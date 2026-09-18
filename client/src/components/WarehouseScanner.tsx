import { useEffect, useRef, useState } from 'react'
import { Camera, ScanLine, X } from 'lucide-react'
import { Button, Input } from './ui'

export default function WarehouseScanner({ onScan, disabled }: { onScan: (code: string) => void; disabled: boolean }) {
  const [camera, setCamera] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const callback = useRef(onScan)
  const blocked = useRef(disabled)
  useEffect(() => { callback.current = onScan; blocked.current = disabled }, [onScan, disabled])

  useEffect(() => {
    if (!camera) return
    let cancelled = false
    let stop: (() => void) | undefined
    let last = { code: '', at: 0 }
    void (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled || !video.current) return
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video.current, result => {
          if (cancelled || blocked.current || !result) return
          const value = result.getText()
          if (value === last.code && Date.now() - last.at < 2500) return
          last = { code: value, at: Date.now() }
          callback.current(value)
        })
        stop = () => controls.stop()
        if (cancelled) stop()
      } catch {
        if (!cancelled) { setError('Camera unavailable. Allow camera access over HTTPS, or use a connected scanner below.'); setCamera(false) }
      }
    })()
    return () => { cancelled = true; stop?.() }
  }, [camera])

  return <section className="rounded-2xl border bg-white p-5 text-zinc-950 space-y-4">
    <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-semibold"><ScanLine /> Scan</h2><Button type="button" variant="outline" className="min-h-12" onClick={() => { setError(''); setCamera(!camera) }}>{camera ? <X size={18} /> : <Camera size={18} />}{camera ? 'Close camera' : 'Open camera'}</Button></div>
    {camera && <video ref={video} muted playsInline className="aspect-video w-full rounded-xl bg-black object-cover" aria-label="Barcode camera preview" />}
    <form onSubmit={e => { e.preventDefault(); if (code.trim() && !disabled) { onScan(code.trim()); setCode(''); input.current?.focus() } }} className="flex gap-2">
      <Input ref={input} autoFocus aria-label="Scan or enter a PurpleBox code" placeholder="Scan or enter PBX-…" value={code} onChange={e => setCode(e.target.value)} className="!h-14 !text-lg font-mono min-w-0" autoComplete="off" />
      <Button disabled={disabled || !code.trim()} className="!h-14">Scan</Button>
    </form>
    <p className="text-sm text-zinc-500">Camera, USB and Bluetooth scanners use the same workflow. Scanner input ends with Enter.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>
}
