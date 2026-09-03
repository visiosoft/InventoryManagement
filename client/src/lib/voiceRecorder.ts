/**
 * Recording a voice note in the browser.
 *
 * The awkward part is the container. WhatsApp accepts Ogg/Opus, MP4/AAC, MP3
 * and AMR — but Chrome's MediaRecorder can only produce `audio/webm;codecs=opus`,
 * which it refuses. The Opus frames inside are exactly right, so the server
 * repackages WebM into Ogg before sending (see services/audioRemux.js). This
 * picks the best container the browser offers, so that on Firefox and Safari
 * the recording is already in a form Meta takes and no repackaging is needed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/* Ordered by what WhatsApp is happiest with, best first. */
/* In the order WhatsApp is happiest with them.
 *
 * mp4 used to sit second, which meant Chrome took it — recent Chrome supports
 * audio/mp4 — and MediaRecorder writes a fragmented mp4 that Meta reads as
 * application/octet-stream and refuses: "Audio file uploaded with mimetype as
 * audio/mp4, however on processing it is of type application/octet-stream."
 *
 * Opus in WebM is repackaged to Ogg on the server and has been delivered and
 * played hundreds of times, so it goes ahead of mp4. mp4 stays last for Safari,
 * which offers nothing else. */
const PREFERRED_TYPES = [
  'audio/ogg;codecs=opus',  // Firefox — already exactly what Meta wants
  'audio/webm;codecs=opus', // Chrome, Edge — repackaged server-side to Ogg
  'audio/webm',
  'audio/mp4',              // Safari, which has no other option
]

export function recordingSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
}

function bestMimeType(): string {
  for (const type of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type
  }
  return '' // let the browser choose
}

/** mm:ss — a voice note is never long enough to need hours. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export type VoiceRecorder = {
  recording: boolean
  seconds: number
  error: string
  start: () => Promise<void>
  /** Stop and hand back the recording. */
  stop: () => Promise<File | null>
  /** Stop and throw it away — the mic still has to be released. */
  cancel: () => void
}

export function useVoiceRecorder(): VoiceRecorder {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const tickRef = useRef<number | null>(null)
  const discardRef = useRef(false)

  /* The microphone stays lit in the browser's UI until every track is
     stopped, so releasing it is not optional housekeeping. */
  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    if (tickRef.current !== null) { window.clearInterval(tickRef.current); tickRef.current = null }
  }, [])

  // A recording left running when the page closes would hold the mic open.
  useEffect(() => release, [release])

  const start = useCallback(async () => {
    setError('')
    if (!recordingSupported()) { setError('This browser cannot record audio'); return }
    if (recorderRef.current) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Voice, not music — let the browser clean it up.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream

      const mimeType = bestMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      discardRef.current = false
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorderRef.current = recorder
      recorder.start()

      setSeconds(0)
      setRecording(true)
      tickRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (e) {
      release()
      setRecording(false)
      // The two real causes need different fixes, and "recording failed"
      // would leave somebody checking the wrong one.
      const name = (e as DOMException)?.name
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked — allow it in your browser’s site settings'
          : name === 'NotFoundError'
            ? 'No microphone was found on this device'
            : `Could not start recording: ${(e as Error)?.message || 'unknown error'}`,
      )
    }
  }, [release])

  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) return null

    const finished = new Promise<File | null>((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        chunksRef.current = []
        if (discardRef.current || blob.size === 0) { resolve(null); return }
        // The extension only has to match the container well enough to be
        // recognisable; the server decides what actually gets sent.
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
        const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '-')
        resolve(new File([blob], `voice-note-${stamp}.${ext}`, { type }))
      }
    })

    recorder.stop()
    const file = await finished
    release()
    setRecording(false)
    return file
  }, [release])

  const cancel = useCallback(() => {
    discardRef.current = true
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    chunksRef.current = []
    release()
    setRecording(false)
    setSeconds(0)
  }, [release])

  return { recording, seconds, error, start, stop, cancel }
}
