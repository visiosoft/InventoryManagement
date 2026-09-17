import { useSearchParams } from 'react-router-dom'

/**
 * Where the "▶️ Watch" link in a video quick reply opens.
 *
 * WhatsApp's own video attachment tops out at 16 MB, well under a real sales
 * video, so the video is hosted here instead: the message that reaches the
 * client is the poster frame with this link, and the video itself plays from
 * this page rather than as a WhatsApp attachment.
 *
 * Public and unauthenticated by necessity — the person opening it has no
 * PurpleBox account. Everything the page needs is already public: the video
 * and poster are the same URLs Meta itself fetched to deliver the WhatsApp
 * message, so there is nothing here worth a server round trip or a token —
 * only a nicer page to open them on than a bare video file.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const PAGE_BG = '#FBF8F2'
const CARD_BG = '#FFFFFF'
const LINE = 'rgba(20,8,31,.10)'
const HEAD = "'Bricolage Grotesque', sans-serif"
const BODY = "'Plus Jakarta Sans', system-ui, sans-serif"

export default function WatchVideo() {
  const [params] = useSearchParams()
  const videoUrl = params.get('v') || ''
  const posterUrl = params.get('p') || ''
  const title = params.get('t') || ''

  return (
    <div style={{ minHeight: '100vh', background: PAGE_BG, fontFamily: BODY, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 0', textAlign: 'center' }}>
        <span style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 20, color: INK, letterSpacing: '-0.01em' }}>PurpleBox</span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ width: '100%', maxWidth: 560 }}>
          {!videoUrl ? (
            <div style={{ background: CARD_BG, border: `1px solid ${LINE}`, borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>This link is missing its video.</p>
            </div>
          ) : (
            <>
              {title && (
                <h1 style={{ fontFamily: HEAD, fontSize: 20, fontWeight: 700, color: INK, margin: '0 0 14px', textAlign: 'center' }}>
                  {title}
                </h1>
              )}
              <div style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 32px rgba(20,8,31,.14)', background: '#000', lineHeight: 0 }}>
                {/* controls + playsInline: native controls, and never a
                    forced-fullscreen takeover on iOS Safari, which is the
                    default there without this attribute. */}
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={posterUrl || undefined}
                  style={{ width: '100%', display: 'block', maxHeight: '80vh' }}
                >
                  <source src={videoUrl} />
                  Your browser can’t play this video —{' '}
                  <a href={videoUrl} style={{ color: PURPLE }}>open it directly</a> instead.
                </video>
              </div>
            </>
          )}
        </div>
      </div>

      <p style={{ padding: '0 20px 24px', fontSize: 12, color: MUTED, textAlign: 'center' }}>
        Sent to you by PurpleBox Storage
      </p>
    </div>
  )
}
