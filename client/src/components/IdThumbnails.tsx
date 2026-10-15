import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { api } from '../lib/api'

type Doc = { _id: string; name: string; type: string; url: string }
const ID_TYPES = ['emirates_id', 'passport', 'id_proof']
const LABEL: Record<string, string> = { emirates_id: 'Emirates ID', passport: 'Passport', id_proof: 'ID' }

/** One thumbnail, fetched through the API (logged in) rather than from Drive. */
function Thumb({ doc }: { doc: Doc }) {
  const [src, setSrc] = useState<string | null>(null)
  const [isImage, setIsImage] = useState(true)
  useEffect(() => {
    let url: string | null = null
    let alive = true
    api.get(`/documents/${doc._id}/file`, { responseType: 'blob' })
      .then((r) => {
        const blob = r.data as Blob
        if (!alive) return
        if (!blob.type.startsWith('image/')) { setIsImage(false); return }
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => alive && setIsImage(false))
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [doc._id])

  return (
    <a href={src || doc.url} target="_blank" rel="noreferrer" title={doc.name}
      style={{ display: 'block', width: 76, textDecoration: 'none' }}>
      <div style={{
        width: 76, height: 52, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(20,8,31,.12)',
        background: '#F5F3F7', display: 'grid', placeItems: 'center',
      }}>
        {src ? <img src={src} alt={doc.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : isImage ? <span style={{ fontSize: 10, color: '#756E80' }}>…</span>
          : <FileText size={18} style={{ color: '#756E80' }} />}
      </div>
      <div style={{ fontSize: 10.5, color: '#756E80', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {LABEL[doc.type] || doc.type}
      </div>
    </a>
  )
}

/** Small thumbnails of the customer's Emirates ID / passport, newest first. Click to open. */
export default function IdThumbnails({ documents, max = 4 }: { documents: Doc[]; max?: number }) {
  const ids = documents.filter((d) => ID_TYPES.includes(d.type)).slice(0, max)
  if (!ids.length) return null
  return (
    <div>
      <div style={{ fontSize: 11.5, color: '#9A93A3', marginBottom: 6 }}>ID documents</div>
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        {ids.map((d) => <Thumb key={d._id} doc={d} />)}
      </div>
    </div>
  )
}
