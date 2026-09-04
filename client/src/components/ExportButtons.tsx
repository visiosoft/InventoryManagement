import { useState } from 'react'
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { api, apiError } from '../lib/api'

/**
 * Download the table you are looking at.
 *
 * The rows are posted rather than the server re-running the query, so the file
 * carries the filters, the window and the sort order that were on screen. A
 * re-run would quietly produce a different document from the one somebody was
 * looking at when they pressed the button.
 */

export type ExportColumn = { label: string; numeric?: boolean }

export function ExportButtons({ title, subtitle, columns, rows, getRows, total, site }: {
  title: string
  subtitle?: string
  columns: ExportColumn[]
  /** One array per row, in the same order as `columns`. */
  rows: (string | number | null)[][]
  /* Fetched when the button is pressed, for a paged table.
   *
   * A page showing 25 of 148 would otherwise export 25 — the file would match
   * the screen and not the answer somebody wanted. Where this is given it wins
   * over `rows`, and `rows` is used only to know whether there is anything to
   * export at all. */
  getRows?: () => Promise<(string | number | null)[][]>
  /** How many rows will actually be written, for the tooltip. Defaults to
   *  what is on screen, which is right when `getRows` is not given. */
  total?: number
  /** Puts the right facility on the PDF letterhead. */
  site?: string | null
}) {
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null)
  const [err, setErr] = useState('')

  async function download(kind: 'xlsx' | 'pdf') {
    setBusy(kind)
    setErr('')
    try {
      const body = getRows ? await getRows() : rows
      const { data, headers } = await api.post(
        `/exports/${kind}${site ? `?site=${site}` : ''}`,
        { title, subtitle, columns, rows: body },
        { responseType: 'blob' },
      )
      // The filename the server chose, so the two cannot disagree.
      const disposition = String(headers['content-disposition'] ?? '')
      const named = /filename="([^"]+)"/.exec(disposition)?.[1]
      const url = URL.createObjectURL(data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = named ?? `export.${kind}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(null)
    }
  }

  const count = total ?? rows.length

  const btn = {
    height: 30, borderRadius: 999, padding: '0 12px', fontSize: 12.5, fontWeight: 600,
    background: '#fff', color: '#2B2440', border: '1px solid rgba(20,8,31,.14)',
  } as const

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => download('xlsx')}
        disabled={busy !== null || !rows.length}
        style={btn}
        className="inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
        title={count ? `Download ${count} rows as a spreadsheet` : 'Nothing to export'}
      >
        {busy === 'xlsx' ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
        Excel
      </button>
      <button
        type="button"
        onClick={() => download('pdf')}
        disabled={busy !== null || !rows.length}
        style={btn}
        className="inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
        title={count ? `Download ${count} rows as a PDF` : 'Nothing to export'}
      >
        {busy === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
        PDF
      </button>
      {err && <span style={{ fontSize: 11.5, color: '#B91C1C' }}>{err}</span>}
    </div>
  )
}

export { Download }
