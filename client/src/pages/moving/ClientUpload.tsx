import { useState, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || '/api'
const api = axios.create({ baseURL: API })

const PURPLE = '#5B2BC9'
const CREAM = '#FDFCFA'
const INK = '#14081F'
const MUTED = '#756E80'

export default function ClientUpload() {
  const { token } = useParams<{ token: string }>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [uploaded, setUploaded] = useState(0)

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['public-upload', token],
    queryFn: () => api.get(`/moving-jobs/public-upload/${token}`).then(r => r.data),
    retry: false,
  })

  const uploadMut = useMutation({
    mutationFn: async (filesToUpload: File[]) => {
      const fd = new FormData()
      filesToUpload.forEach(f => fd.append('files', f))
      fd.append('category', 'Client Upload')
      return api.post(`/moving-jobs/public-upload/${token}/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data)
    },
    onSuccess: (data) => {
      setUploaded(prev => prev + data.uploaded)
      setFiles([])
      setPreviews([])
    },
  })

  const handleFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return
    const arr = Array.from(incoming)
    setFiles(prev => [...prev, ...arr])
    arr.forEach(f => {
      if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
        const reader = new FileReader()
        reader.onload = (e) => setPreviews(prev => [...prev, e.target?.result as string])
        reader.readAsDataURL(f)
      } else {
        setPreviews(prev => [...prev, ''])
      }
    })
  }, [])

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
    setPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: CREAM, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: MUTED }}>
          <div style={{ width: 40, height: 40, border: `3px solid ${PURPLE}33`, borderTopColor: PURPLE, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p>Loading...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div style={{ minHeight: '100vh', background: CREAM, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 28 }}>!</div>
          <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 22, color: INK, margin: '0 0 8px' }}>Invalid Link</h1>
          <p style={{ color: MUTED, fontSize: 14 }}>This upload link is invalid or has expired. Please contact PurpleBox for a new link.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: CREAM }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg) } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      {/* Header */}
      <header style={{ background: INK, padding: '20px 24px', textAlign: 'center' }}>
        <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px' }}>
          <span style={{ color: PURPLE }}>Purple</span>Box Move
        </h1>
      </header>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px' }}>
        {/* Job info card */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <p style={{ fontSize: 13, color: MUTED, marginBottom: 4 }}>Upload files for</p>
          <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 20, fontWeight: 600, color: INK, marginBottom: 8 }}>
            Job {job.jobNo}
          </h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: MUTED }}>
            {job.customerName && <span>{job.customerName}</span>}
            {job.scheduledDate && <span>{new Date(job.scheduledDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
            <span>{job.imageCount} file{job.imageCount !== 1 ? 's' : ''} uploaded</span>
          </div>
        </div>

        {/* Success banner */}
        {uploaded > 0 && (
          <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 10, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>&#10003;</span>
            <span style={{ color: '#166534', fontSize: 14 }}>{uploaded} file{uploaded !== 1 ? 's' : ''} uploaded successfully!</span>
          </div>
        )}

        {/* Upload area */}
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: '#fff',
            border: `2px dashed ${PURPLE}40`,
            borderRadius: 12,
            padding: '48px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
            marginBottom: 24,
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = PURPLE)}
          onMouseLeave={e => (e.currentTarget.style.borderColor = `${PURPLE}40`)}
        >
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.7 }}>&#128247;</div>
          <p style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 16, fontWeight: 600, color: INK, marginBottom: 6 }}>
            Tap to select or drag & drop
          </p>
          <p style={{ fontSize: 13, color: MUTED }}>Photos and videos · Max 50MB per file</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
        </div>

        {/* File previews */}
        {files.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 15, fontWeight: 600, color: INK }}>
                {files.length} file{files.length !== 1 ? 's' : ''} selected
              </p>
              <button
                onClick={() => { setFiles([]); setPreviews([]) }}
                style={{ background: 'none', border: 'none', color: MUTED, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Clear all
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 10 }}>
              {files.map((f, i) => (
                <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: '#f4f4f5' }}>
                  {previews[i] && f.type.startsWith('image/') ? (
                    <img src={previews[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : previews[i] && f.type.startsWith('video/') ? (
                    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: MUTED, padding: 8, textAlign: 'center' }}>
                      <span style={{ fontSize: 28, marginBottom: 4 }}>&#127909;</span>
                      <span style={{ wordBreak: 'break-all' }}>{f.name.substring(0, 20)}</span>
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: MUTED, padding: 8, textAlign: 'center', wordBreak: 'break-all' }}>
                      {f.name.substring(0, 20)}
                    </div>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                    style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>

            {/* Upload button */}
            <button
              onClick={() => uploadMut.mutate(files)}
              disabled={uploadMut.isPending}
              style={{
                width: '100%',
                marginTop: 16,
                padding: '14px 24px',
                background: uploadMut.isPending ? `${PURPLE}80` : PURPLE,
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                fontFamily: "'Bricolage Grotesque', sans-serif",
                cursor: uploadMut.isPending ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {uploadMut.isPending ? (
                <>
                  <span style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block' }} />
                  Uploading...
                </>
              ) : (
                `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`
              )}
            </button>

            {uploadMut.isError && (
              <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
                Upload failed. Please try again.
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: 12, color: MUTED, marginTop: 32 }}>
          Powered by PurpleBox &middot; Your files are securely stored
        </p>
      </div>
    </div>
  )
}
