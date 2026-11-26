'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Database, FileUp, ListTree, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

function Button({ children, onClick, variant = 'primary', type = 'button', disabled = false }: {
  children: React.ReactNode; onClick?: React.MouseEventHandler<HTMLButtonElement>; variant?: 'primary' | 'secondary' | 'danger'; type?: 'button' | 'submit'; disabled?: boolean
}) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`button button-${variant}`}>{children}</button>
}

type Method = 'replace' | 'append' | 'manual'
type Notice = { kind: 'success' | 'error' | 'info'; title: string; text: string } | null
type Sample = {
  booking_id: string; booking_date: string; booking_time: string | null; booking_status: string
  customer_id: string | null; vehicle_type: string | null; pickup_location: string | null
  drop_location: string | null; payment_method: string | null; booking_value: string | null
  ride_distance: string | null; avg_vtat: string | null; avg_ctat: string | null
  driver_rating: string | null; customer_rating: string | null; reason: string | null; in_database: boolean
}
type AnalysisSample = {
  booking_id: string; booking_date: string; booking_time: string | null; booking_status: string
  customer_id: string | null; vehicle_type: string | null; pickup_location: string | null
  drop_location: string | null; payment_method: string | null; booking_value: string | null
  ride_distance: string | null; avg_vtat: string | null; avg_ctat: string | null
  driver_rating: string | null; customer_rating: string | null; reason: string | null
  in_database: boolean
}
type Analysis = {
  fileName: string; fileSize: number; databaseRows: number
  headerOk: boolean; headerError: string | null
  dataRows: number; validRows: number; invalidRows: number
  duplicateInFile: number; alreadyInDatabase: number; uniqueInFile: number; newRows: number
  canReplace: boolean; canAppend: boolean
  dateFrom: string | null; dateTo: string | null
  statusCounts: Record<string, number>
  errors: { row: number; message: string }[]
  samples: AnalysisSample[]
}
type PreviewRow = {
  ride_id: number
  booking_id: string
  booking_date: string
  booking_time: string | null
  booking_status: string
  customer_id: string | null
  vehicle_type: string | null
  pickup_location: string | null
  drop_location: string | null
  avg_vtat: number | null
  avg_ctat: number | null
  booking_value: number | null
  ride_distance: number | null
  driver_rating: number | null
  customer_rating: number | null
  payment_method: string | null
}
type Preview = { rows: PreviewRow[]; total: number; totalAll: number; page: number; pageSize: number }

const METHODS: { id: Method; title: string; desc: string; icon: typeof Upload }[] = [
  { id: 'replace', title: 'Timpa Dataset', desc: 'Ganti seluruh dataset lama dengan CSV yang baru.', icon: Upload },
  { id: 'append', title: 'Tambah Data (Import)', desc: 'Tambahkan baris dari CSV ke dataset yang sudah ada.', icon: Plus },
  { id: 'manual', title: 'Input Manual', desc: 'Isi satu data pemesanan tanpa perlu mengunggah CSV.', icon: ListTree },
]

const STATUS_OPTIONS = [
  { value: 'Completed', label: 'Completed (Selesai)' },
  { value: 'Cancelled by Driver', label: 'Cancelled by Driver (Dibatalkan pengemudi)' },
  { value: 'Cancelled by Customer', label: 'Cancelled by Customer (Dibatalkan pelanggan)' },
  { value: 'No Driver Found', label: 'No Driver Found (Pengemudi tidak ditemukan)' },
  { value: 'Incomplete', label: 'Incomplete (Perjalanan tidak selesai)' },
]
const VEHICLES = ['Auto', 'Bike', 'eBike', 'Go Mini', 'Go Sedan', 'Premier Sedan', 'Uber XL']
const PAYMENTS = ['UPI', 'Cash', 'Uber Wallet', 'Credit Card', 'Debit Card']
const REASON_HINTS: Record<string, string[]> = {
  'Cancelled by Customer': ['Wrong Address', 'Change of plans', 'Driver asked to cancel', 'AC is not working'],
  'Cancelled by Driver': ['Personal & Car related issues', 'Customer related issue', 'More than permitted people in there'],
  Incomplete: ['Vehicle Breakdown', 'Customer Demand', 'Other Issue'],
}

const EMPTY_FORM = {
  booking_id: '', booking_date: '', booking_time: '', booking_status: 'Completed', customer_id: '',
  vehicle_type: '', pickup_location: '', drop_location: '', payment_method: '', booking_value: '',
  ride_distance: '', avg_vtat: '', avg_ctat: '', driver_rating: '', customer_rating: '', reason: '',
}
type FormState = typeof EMPTY_FORM

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Permintaan gagal.')
  return result
}

const fmt = (value: string | number | null, digits?: number) =>
  value === null || value === undefined || value === '' ? '—'
    : typeof value === 'number' && digits !== undefined ? value.toLocaleString('id-ID', { maximumFractionDigits: digits })
      : String(value)
const num = (n: number) => n.toLocaleString('id-ID')
const MAX_BYTES = 50 * 1024 * 1024
const MAX_SELECTED_ROWS = 1000

export function EtlWorkspace({ onChanged, onOpenDashboard }: {
  onChanged: () => Promise<void>; onOpenDashboard: () => void
}) {
  const notify = useToast()
  const setNotice = (notice: Notice) => { if (notice) notify(notice) }
  const [method, setMethod] = useState<Method | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [sampleKey, setSampleKey] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(1)
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [tick, setTick] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const stepTwoRef = useRef<HTMLElement>(null)
  const analyzeRun = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(searchInput.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ page: String(page), order })
    if (query) params.set('q', query)
    fetch(`/api/etl/preview?${params}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Data gagal dimuat.')
        setPreview(result); setPreviewError('')
      })
      .catch(error => { if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : 'Data gagal dimuat.') })
    return () => controller.abort()
  }, [page, order, query, tick])

  const refreshAfterChange = async (newestFirst: boolean, preserveView = false) => {
    if (!preserveView) {
      setSearchInput(''); setQuery(''); setPage(1)
      setOrder(newestFirst ? 'desc' : 'asc')
    }
    setTick(value => value + 1)
    try {
      await onChanged()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Ringkasan sesi gagal diperbarui.'
    }
  }

  const dbRows = preview?.totalAll ?? 0

  // LANGKAH 1: pilih berkas -> langsung dianalisis di server (database belum disentuh).
  const chooseFile = async (selected: File | undefined) => {
    if (!selected) return
    setNotice(null); setAnalysis(null); setSampleKey('')
    if (!selected.name.toLowerCase().endsWith('.csv') || selected.size === 0 || selected.size > MAX_BYTES) {
      setFile(null)
      setNotice({ kind: 'error', title: 'Perhatian', text: 'Berkas harus berupa CSV dengan ukuran maksimal 50 MB.' })
      return
    }
    setFile(selected)
    const run = ++analyzeRun.current
    setAnalyzing(true)
    try {
      const body = new FormData()
      body.set('file', selected)
      const result = await api('/api/etl/analyze', { method: 'POST', body }) as Analysis
      if (run !== analyzeRun.current) return
      setAnalysis(result)
      if (!result.headerOk) {
        setNotice({ kind: 'error', title: 'Format berkas tidak sesuai', text: result.headerError ?? 'Header CSV tidak dikenali.' })
      } else if (result.dataRows === 0) {
        setNotice({ kind: 'error', title: 'CSV belum memiliki data', text: 'Tambahkan minimal satu baris pemesanan setelah header.' })
      } else if (result.invalidRows > 0) {
        setNotice({
          kind: 'error',
          title: 'Validasi CSV menemukan baris bermasalah',
          text: `${num(result.invalidRows)} baris tidak valid. Rincian kesalahan ditampilkan pada hasil pemeriksaan berkas.`,
        })
      }
    } catch (error) {
      if (run !== analyzeRun.current) return
      setNotice({ kind: 'error', title: 'Berkas gagal dianalisis', text: error instanceof Error ? error.message : 'Berkas gagal dianalisis.' })
    } finally {
      if (run === analyzeRun.current) setAnalyzing(false)
    }
  }

  const clearFile = () => {
    analyzeRun.current++
    setFile(null); setAnalysis(null); setAnalyzing(false); setNotice(null); setMethod(null); setSampleKey('')
  }

  const pickMethod = (next: Method) => {
    setMethod(next); setNotice(null)
    if (next !== 'manual' && !file) {
      setNotice({ kind: 'info', title: 'Pilih dataset CSV', text: 'Tambah Data dan Timpa Dataset memerlukan berkas CSV baru.' })
      inputRef.current?.click()
    }
    requestAnimationFrame(() => stepTwoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  const recommended: Method | null = !analysis?.headerOk ? null
    : dbRows === 0 || !analysis.canAppend ? (analysis.canReplace ? 'replace' : null) : 'append'
  const defaultSaveMode: Exclude<Method, 'manual'> | null = !analysis?.headerOk || analysis.invalidRows > 0
    ? null
    : analysis.databaseRows === 0
      ? analysis.canReplace ? 'replace' : null
      : analysis.canAppend ? 'append' : null
  const saveMode = method === 'replace' || method === 'append' ? method : defaultSaveMode

  const disabledReason = (id: Method): string | null => {
    if (analyzing) return 'Sedang dianalisis…'
    if (id === 'manual') return null
    if (!file) return null
    if (!analysis) return 'Berkas belum dapat dibaca'
    if (!analysis.headerOk) return 'Format berkas tidak sesuai'
    if (analysis.dataRows === 0) return 'CSV belum memiliki baris data'
    if (analysis.invalidRows > 0) return `${num(analysis.invalidRows)} baris tidak valid`
    if (id === 'append' && !analysis.canAppend) return 'Tidak ada baris baru'
    if (id === 'replace' && !analysis.canReplace) return 'Tidak ada baris valid'
    return null
  }

  const runImport = async (requestedMode?: Exclude<Method, 'manual'>, openDashboard = false) => {
    const importMode = requestedMode ?? (method === 'replace' || method === 'append' ? method : null)
    if (!file || !analysis || busy || !importMode) return
    if (importMode === 'replace' && dbRows > 0) {
      const ok = window.confirm(`Seluruh dataset lama (${num(dbRows)} baris) akan dihapus dan diganti dengan hingga ${num(analysis.uniqueInFile)} baris unik dari "${file.name}". Lanjutkan?`)
      if (!ok) return
    }
    setBusy(true)
    setNotice({ kind: 'info', title: 'Memproses', text: 'Mengimpor data ke database...' })
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('mode', importMode)
      const result = await api('/api/etl/upload', { method: 'POST', body })
      const refreshError = await refreshAfterChange(importMode === 'append')
      const total = Number(result.totalRows).toLocaleString('id-ID')
      const added = Number(result.rowCount).toLocaleString('id-ID')
      const skipped = Number(result.skipped)
      const importMessage = importMode === 'replace'
        ? `${added} baris dari ${result.fileName} kini menggantikan dataset lama.${skipped ? ` ${skipped.toLocaleString('id-ID')} baris duplikat dalam CSV dilewati.` : ''}`
        : `${added} baris baru ditambahkan dari ${result.fileName}.${skipped ? ` ${skipped.toLocaleString('id-ID')} baris dilewati karena Booking ID sudah ada.` : ''} Total data sekarang ${total} baris.`
      setNotice(refreshError
        ? { kind: 'error', title: 'Dataset tersimpan, tampilan belum diperbarui', text: `${importMessage} Namun sesi gagal diperbarui: ${refreshError}` }
        : { kind: 'success', title: importMode === 'replace' ? 'Dataset berhasil ditimpa' : 'Data berhasil ditambahkan', text: importMessage })
      setSelectedIds(new Set())
      setFile(null); setAnalysis(null); setMethod(null)
      if (openDashboard && !refreshError) onOpenDashboard()
    } catch (error) {
      setNotice({ kind: 'error', title: 'Proses ETL gagal', text: error instanceof Error ? error.message : 'Proses ETL gagal.' })
    } finally {
      setBusy(false)
    }
  }

  const clearDatabase = async () => {
    if (busy || analyzing || dbRows === 0) return
    const confirmed = window.confirm(
      `Hapus seluruh dataset (${num(dbRows)} baris) dan riwayat impor dari database? Akun admin tidak akan dihapus.`,
    )
    if (!confirmed) return

    setBusy(true)
    setNotice({ kind: 'info', title: 'Menghapus dataset', text: 'Menghapus data dan riwayat impor dari database...' })
    try {
      const result = await api('/api/etl/clear', { method: 'POST' })
      analyzeRun.current++
      setFile(null); setAnalysis(null); setAnalyzing(false); setMethod(null); setSampleKey('')
      setForm(EMPTY_FORM)
      setSelectedIds(new Set())
      const refreshError = await refreshAfterChange(false)
      const clearedRows = Number(result.deletedRows).toLocaleString('id-ID')
      setNotice(refreshError
        ? { kind: 'error', title: 'Dataset terhapus, tampilan belum diperbarui', text: `${clearedRows} baris berhasil dihapus. Namun sesi gagal diperbarui: ${refreshError}` }
        : { kind: 'success', title: 'Dataset berhasil dihapus', text: `${clearedRows} baris dan riwayat impor telah dihapus. Akun admin tetap tersimpan.` })
    } catch (error) {
      setNotice({ kind: 'error', title: 'Dataset belum terhapus', text: error instanceof Error ? error.message : 'Dataset gagal dihapus.' })
    } finally {
      setBusy(false)
    }
  }

  const toggleSelectedRow = (id: number) => {
    if (!selectedIds.has(id) && selectedIds.size >= MAX_SELECTED_ROWS) {
      setNotice({ kind: 'error', title: 'Batas pilihan tercapai', text: `Pilih maksimal ${num(MAX_SELECTED_ROWS)} baris sekaligus.` })
      return
    }
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCurrentPage = () => {
    const ids = preview?.rows.map(row => row.ride_id) ?? []
    if (!ids.length) return
    const allSelected = ids.every(id => selectedIds.has(id))
    if (!allSelected && new Set([...selectedIds, ...ids]).size > MAX_SELECTED_ROWS) {
      setNotice({ kind: 'error', title: 'Batas pilihan tercapai', text: `Pilih maksimal ${num(MAX_SELECTED_ROWS)} baris sekaligus.` })
      return
    }
    setSelectedIds(current => {
      const next = new Set(current)
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id))
      return next
    })
  }

  const deleteSelectedRows = async () => {
    if (busy || selectedIds.size === 0) return
    const ids = [...selectedIds]
    if (!window.confirm(`Hapus ${num(ids.length)} baris yang dipilih saja? Baris lain dan riwayat impor tidak akan dihapus.`)) return

    const selected = new Set(ids)
    const deletedFromCurrentPage = preview?.rows.filter(row => selected.has(row.ride_id)).length ?? 0
    const pageSize = preview?.pageSize ?? 15
    const remainingFilteredRows = Math.max(0, (preview?.total ?? 0) - deletedFromCurrentPage)
    const nextPage = Math.max(1, Math.min(page, Math.ceil(remainingFilteredRows / pageSize) || 1))

    setBusy(true)
    setNotice({ kind: 'info', title: 'Menghapus baris terpilih', text: 'Menghapus hanya data yang Anda pilih...' })
    try {
      const result = await api('/api/etl/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rideIds: ids }),
      })
      setSelectedIds(new Set())
      setPage(nextPage)
      const refreshError = await refreshAfterChange(order === 'desc', true)
      const deletedRows = Number(result.deletedRows).toLocaleString('id-ID')
      setNotice(refreshError
        ? { kind: 'error', title: 'Baris terhapus, tampilan belum diperbarui', text: `${deletedRows} baris terpilih berhasil dihapus. Namun sesi gagal diperbarui: ${refreshError}` }
        : { kind: 'success', title: 'Baris terpilih berhasil dihapus', text: `${deletedRows} baris dihapus. Baris lainnya tetap tersimpan.` })
    } catch (error) {
      setNotice({ kind: 'error', title: 'Baris belum terhapus', text: error instanceof Error ? error.message : 'Baris terpilih gagal dihapus.' })
    } finally {
      setBusy(false)
    }
  }

  const setField = (name: keyof FormState, value: string) => setForm(current => ({ ...current, [name]: value }))

  // Input manual dapat dimulai dari salah satu baris berkas yang sudah diunggah, lalu dikoreksi sebelum disimpan.
  const fillFromSample = (key: string) => {
    setSampleKey(key)
    const sample = analysis?.samples.find(item => item.booking_id === key)
    if (!sample) return
    setForm({
      booking_id: sample.booking_id, booking_date: sample.booking_date, booking_time: sample.booking_time ?? '',
      booking_status: STATUS_OPTIONS.some(o => o.value === sample.booking_status) ? sample.booking_status : 'Completed',
      customer_id: sample.customer_id ?? '', vehicle_type: sample.vehicle_type ?? '',
      pickup_location: sample.pickup_location ?? '', drop_location: sample.drop_location ?? '',
      payment_method: sample.payment_method ?? '', booking_value: sample.booking_value ?? '',
      ride_distance: sample.ride_distance ?? '', avg_vtat: sample.avg_vtat ?? '', avg_ctat: sample.avg_ctat ?? '',
      driver_rating: sample.driver_rating ?? '', customer_rating: sample.customer_rating ?? '', reason: sample.reason ?? '',
    })
    setNotice(null)
  }

  const submitManual = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const manualForm = event.currentTarget
    if (!manualForm.checkValidity()) {
      const invalid = manualForm.querySelector(':invalid')
      const message = invalid instanceof HTMLInputElement || invalid instanceof HTMLSelectElement
        ? invalid.validationMessage
        : 'Periksa kembali kolom yang wajib diisi.'
      setNotice({ kind: 'error', title: 'Periksa data pemesanan', text: message })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const body = new FormData()
      body.set('data', JSON.stringify(form))
      const result = await api('/api/etl/manual', {
        method: 'POST', body,
      })
      const refreshError = await refreshAfterChange(true)
      setForm({ ...EMPTY_FORM, booking_status: form.booking_status }); setSampleKey('')
      setNotice(refreshError
        ? { kind: 'error', title: 'Data tersimpan, tampilan belum diperbarui', text: `Booking ${result.bookingId} ditambahkan. Namun sesi gagal diperbarui: ${refreshError}` }
        : { kind: 'success', title: 'Data berhasil disimpan', text: `Booking ${result.bookingId} ditambahkan. Total data sekarang ${Number(result.totalRows).toLocaleString('id-ID')} baris.` })
    } catch (error) {
      setNotice({ kind: 'error', title: 'Data belum tersimpan', text: error instanceof Error ? error.message : 'Data gagal disimpan.' })
    } finally {
      setBusy(false)
    }
  }

  const completed = form.booking_status === 'Completed'
  const needsReason = form.booking_status !== 'Completed' && form.booking_status !== 'No Driver Found'
  const lastPage = preview ? Math.max(1, Math.ceil(preview.total / preview.pageSize)) : 1
  const from = preview && preview.total ? (preview.page - 1) * preview.pageSize + 1 : 0
  const to = preview ? Math.min(preview.total, preview.page * preview.pageSize) : 0
  const active = method ? METHODS.find(item => item.id === method)! : null

  return (
    <div className="etl-content etl-wide">
      <div className="eyebrow">MANAJEMEN DATA <span>•</span> RUANG KERJA ETL</div>
      <h1>Pemuatan dataset</h1>
      <p className="etl-lead">Unggah CSV untuk meninjau, menambah, atau menimpa data. Input Manual dapat digunakan langsung tanpa mengunggah CSV.</p>

      {/* LANGKAH 1 — UNGGAH DATASET */}
      <section className="step-card">
        <div className="step-head"><span className="step-badge">1</span>
          <div><h2>Unggah dataset</h2><p>Periksa isi CSV sebelum memilih tindakan. Data tersimpan tidak berubah sampai Anda mengonfirmasi langkah berikutnya.</p></div></div>
        <div className={`upload-panel ${dragging ? 'drop-active' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); void chooseFile(event.dataTransfer.files[0]) }}>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only"
            onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} />
          <div className="upload-icon">{analyzing ? <span className="spinner" aria-hidden /> : <Upload size={21} />}</div>
          <h2>{file ? 'Ganti berkas' : 'Tarik berkas CSV ke sini'}</h2>
          <p>{analyzing ? 'Menganalisis berkas…' : 'atau pilih dari komputer Anda'}</p>
          <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={analyzing || busy}><FileUp size={15} /> Pilih berkas</Button>
          <span className="upload-hint">Format CSV · Ukuran maksimum 50 MB · Header kolom harus sesuai format dataset</span>
          {file && (
            <div className="file-chip"><FileUp size={15} />
              <span><b>{file.name}</b><small>{file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`}</small></span>
              <button aria-label="Hapus berkas" onClick={clearFile} disabled={busy}><X size={15} /></button>
            </div>
          )}
          <div className="expected-file"><Database size={15} /><span>Dataset tersimpan saat ini</span>
            <b>{preview ? dbRows ? `${num(dbRows)} baris` : 'Belum ada dataset' : 'Memuat…'}</b></div>
        </div>

        {analysis?.headerOk && (
          <div className="az-result" aria-live="polite">
            <div className="az-title"><Check size={15} /> Hasil pemeriksaan berkas</div>
            <div className="az-stats">
              <div className="az-stat"><small>Baris data</small><b>{num(analysis.dataRows)}</b></div>
              <div className={`az-stat ${analysis.invalidRows ? 'bad' : 'good'}`}><small>Baris valid</small><b>{num(analysis.validRows)}</b>{analysis.invalidRows > 0 && <em>{num(analysis.invalidRows)} tidak valid</em>}</div>
              <div className="az-stat"><small>Baris baru</small><b>{num(analysis.newRows)}</b><em>belum ada di database</em></div>
              <div className="az-stat"><small>Sudah ada</small><b>{num(analysis.alreadyInDatabase)}</b><em>Booking ID sama</em></div>
              <div className="az-stat"><small>Duplikat dalam berkas</small><b>{num(analysis.duplicateInFile)}</b></div>
              <div className="az-stat"><small>Rentang tanggal</small><b className="az-range">{analysis.dateFrom ?? '—'}{analysis.dateTo && analysis.dateTo !== analysis.dateFrom ? ` → ${analysis.dateTo}` : ''}</b></div>
            </div>
            {Object.keys(analysis.statusCounts).length > 0 && (
              <div className="az-status">
                {(Object.entries(analysis.statusCounts) as [string, number][]).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                  <span key={status}>{status}<b>{num(count)}</b></span>
                ))}
              </div>
            )}
            {analysis.errors.length > 0 && (
              <div className="az-errors" role="alert">
                <b><X size={14} /> Perbaiki baris berikut agar Timpa/Tambah dapat dipakai</b>
                <ul>{analysis.errors.map(item => <li key={item.row + item.message}>{item.message}</li>)}</ul>
                {analysis.invalidRows > analysis.errors.length && <small>…dan {num(analysis.invalidRows - analysis.errors.length)} baris lain. Input manual tetap bisa dipakai.</small>}
              </div>
            )}
            {analysis.samples.length > 0 && (
              <details className="az-samples" open>
                <summary>Pratinjau {analysis.samples.length} baris pertama dari {file?.name}</summary>
                <div className="table-wrap"><table>
                  <thead><tr>{['BOOKING ID', 'TANGGAL', 'STATUS', 'KENDARAAN', 'NILAI', 'DI DATABASE'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{analysis.samples.map(s => (
                    <tr key={s.booking_id}><td className="booking-id">{s.booking_id}</td><td>{s.booking_date}</td><td>{s.booking_status}</td>
                      <td>{fmt(s.vehicle_type)}</td><td className="fare">{s.booking_value ? num(Number(s.booking_value)) : '—'}</td>
                      <td>{s.in_database ? 'Sudah ada' : 'Baru'}</td></tr>
                  ))}</tbody>
                </table></div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* LANGKAH 2 — PILIH TINDAKAN */}
      <section className="step-card" ref={stepTwoRef}>
        <div className="step-head"><span className="step-badge">2</span>
          <div><h2>Lanjutkan ke</h2><p>{analysis?.headerOk ? 'Pilih tindakan setelah memeriksa pratinjau dataset.' : 'Input Manual dapat digunakan langsung. Tambah Data dan Timpa Dataset akan meminta CSV baru.'}</p></div></div>

        <div className="method-tabs" role="tablist">
          {METHODS.map(item => {
            const reason = disabledReason(item.id)
            const helper = !file && item.id !== 'manual' ? 'Pilih CSV untuk melanjutkan' : reason ?? item.desc
            return (
              <button key={item.id} role="tab" aria-selected={method === item.id} disabled={!!reason || busy}
                className={`method-tab ${method === item.id ? 'active' : ''} ${reason ? 'is-disabled' : ''}`}
                onClick={() => pickMethod(item.id)}>
                <item.icon size={16} /><span><b>{item.title}{recommended === item.id && <i className="rec-badge">Disarankan</i>}</b><small>{helper}</small></span>
              </button>
            )
          })}
        </div>

        {analysis?.headerOk && analysis.dataRows > 0 && method !== 'manual' && (
          <div className="save-dashboard">
            <div>
              <b>Simpan dataset ke database</b>
              <p>{saveMode === 'replace'
                ? 'Database masih kosong. Dataset ini akan disimpan sebagai dataset baru.'
                : saveMode === 'append'
                  ? `${num(analysis.newRows)} baris baru akan ditambahkan tanpa menghapus data yang sudah tersimpan.`
                  : 'Tidak ada baris valid yang bisa disimpan otomatis. Pilih Timpa Dataset atau Input Manual.'}</p>
            </div>
            <Button onClick={() => runImport(saveMode ?? undefined, true)} disabled={busy || !saveMode}>
              <Check size={16} /> {busy ? 'Menyimpan...' : 'Simpan ke Database & Buka Dashboard'}
            </Button>
          </div>
        )}

        {(method === 'replace' || method === 'append') && analysis && file && (
          <div className="az-confirm">
            <p>
              {method === 'replace'
                ? <>Seluruh <b>{num(dbRows)}</b> baris lama akan dihapus dan diganti dengan hingga <b>{num(analysis.uniqueInFile)}</b> baris unik dari <b>{file.name}</b>.</>
                : <><b>{num(analysis.newRows)}</b> baris baru akan ditambahkan ke <b>{num(dbRows)}</b> baris yang sudah ada.{analysis.alreadyInDatabase + analysis.duplicateInFile > 0 && <> Booking ID yang sudah ada dilewati.</>}</>}
            </p>
            <div className="etl-actions">
              <Button onClick={() => runImport()} disabled={busy}>
                {method === 'replace' ? <Upload size={16} /> : <Plus size={16} />}
                {busy ? 'Memproses...' : method === 'replace' ? 'Timpa Dataset' : 'Tambahkan Data'}
              </Button>
            </div>
          </div>
        )}

        {method === 'manual' && (
          <form className="manual-form" onSubmit={submitManual} noValidate>
            <h2>Input data pemesanan</h2>
            <p>Kolom bertanda * wajib diisi sesuai status pemesanan. CSV opsional untuk mengisi otomatis dari sampel.</p>
            {analysis?.headerOk && analysis.samples.length > 0 && (
              <label className="sample-picker">Isi otomatis dari berkas yang diunggah
                <select value={sampleKey} onChange={e => fillFromSample(e.target.value)}>
                  <option value="">— Pilih baris dari {file?.name} —</option>
                  {analysis.samples.map(s => <option key={s.booking_id} value={s.booking_id}>{s.booking_id} · {s.booking_status}{s.in_database ? ' (sudah ada di database)' : ''}</option>)}
                </select>
              </label>
            )}
            <div className="form-grid">
              <label>Booking ID *<input value={form.booking_id} onChange={e => setField('booking_id', e.target.value)} placeholder="CNR1234567" required /></label>
              <label>Tanggal *<input type="date" value={form.booking_date} onChange={e => setField('booking_date', e.target.value)} required /></label>
              <label>Waktu<input type="time" step={1} value={form.booking_time} onChange={e => setField('booking_time', e.target.value)} /></label>
              <label>Status pemesanan *
                <select value={form.booking_status} onChange={e => setField('booking_status', e.target.value)}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label>Customer ID *<input value={form.customer_id} onChange={e => setField('customer_id', e.target.value)} placeholder="CID1234567" required /></label>
              <label>Jenis kendaraan *<input list="etl-vehicles" value={form.vehicle_type} onChange={e => setField('vehicle_type', e.target.value)} required />
                <datalist id="etl-vehicles">{VEHICLES.map(v => <option key={v} value={v} />)}</datalist></label>
              <label>Lokasi jemput<input value={form.pickup_location} onChange={e => setField('pickup_location', e.target.value)} /></label>
              <label>Lokasi tujuan<input value={form.drop_location} onChange={e => setField('drop_location', e.target.value)} /></label>
              <label>Metode pembayaran{completed ? ' *' : ''}
                <select value={form.payment_method} onChange={e => setField('payment_method', e.target.value)} required={completed}>
                  <option value="">— Pilih —</option>
                  {PAYMENTS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label>Nilai pemesanan{completed ? ' *' : ''}<input type="number" min={0} step="any" value={form.booking_value} onChange={e => setField('booking_value', e.target.value)} required={completed} /></label>
              <label>Jarak perjalanan (km)<input type="number" min={0} step="any" value={form.ride_distance} onChange={e => setField('ride_distance', e.target.value)} /></label>
              <label>Avg VTAT (menit)<input type="number" min={0} step="any" value={form.avg_vtat} onChange={e => setField('avg_vtat', e.target.value)} /></label>
              <label>Avg CTAT (menit)<input type="number" min={0} step="any" value={form.avg_ctat} onChange={e => setField('avg_ctat', e.target.value)} /></label>
              {completed && <>
                <label>Rating pengemudi (0–5)<input type="number" min={0} max={5} step="any" value={form.driver_rating} onChange={e => setField('driver_rating', e.target.value)} /></label>
                <label>Rating pelanggan (0–5)<input type="number" min={0} max={5} step="any" value={form.customer_rating} onChange={e => setField('customer_rating', e.target.value)} /></label>
              </>}
              {needsReason && (
                <label className="span-2">Alasan {form.booking_status === 'Incomplete' ? 'perjalanan tidak selesai' : 'pembatalan'} *
                  <input list="etl-reasons" value={form.reason} onChange={e => setField('reason', e.target.value)} required />
                  <datalist id="etl-reasons">{(REASON_HINTS[form.booking_status] ?? []).map(r => <option key={r} value={r} />)}</datalist>
                </label>
              )}
            </div>
            <div className="etl-actions">
              <Button type="submit" disabled={busy}><Check size={16} /> Simpan Data</Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => { setForm(EMPTY_FORM); setSampleKey(''); setNotice(null) }}>Kosongkan Form</Button>
            </div>
          </form>
        )}

        {active && (
          <section className="etl-note"><Database size={17} />
            <div><b>{active.title}</b><p>
              {method === 'replace' && 'Berkas divalidasi di server lalu menggantikan seluruh dataset aktif secara atomik. Jika ada baris yang tidak valid, dataset lama tetap utuh.'}
              {method === 'append' && 'Data lama dipertahankan; hanya Booking ID yang belum ada yang ditambahkan. Jika ada baris tidak valid, tidak ada yang ditambahkan.'}
              {method === 'manual' && 'Data divalidasi dengan aturan yang sama seperti impor CSV. Booking ID harus unik dan baris baru langsung muncul di dashboard.'}
            </p></div>
          </section>
        )}
      </section>

      <section className="panel table-panel etl-table">
        <div className="table-heading">
          <div><h3>Dataset tersimpan di database</h3>
            <p>{preview ? `${preview.totalAll.toLocaleString('id-ID')} baris tersimpan` : 'Memuat data...'}{query && preview ? ` · ${preview.total.toLocaleString('id-ID')} cocok dengan pencarian` : ''}</p></div>
          <div className="table-tools">
            <label className="search-box"><Search size={13} />
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Cari Booking ID, Customer ID, lokasi" aria-label="Cari data" />
            </label>
            <select className="order-select" value={order} aria-label="Urutan data"
              onChange={e => { setOrder(e.target.value as 'asc' | 'desc'); setPage(1) }}>
              <option value="asc">Urutan awal</option>
              <option value="desc">Terbaru dulu</option>
            </select>
            <Button variant="danger" onClick={deleteSelectedRows} disabled={busy || selectedIds.size === 0}>
              <Trash2 size={14} /> Hapus Dipilih ({num(selectedIds.size)})
            </Button>
            <Button variant="secondary" onClick={clearDatabase} disabled={busy || analyzing || dbRows === 0}>
              <Trash2 size={14} /> Hapus Seluruh Dataset
            </Button>
          </div>
        </div>
        {previewError && <div className="no-results">{previewError}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th className="select-column">
                <input className="row-select" type="checkbox" aria-label="Pilih semua baris di halaman ini"
                  checked={!!preview?.rows.length && preview.rows.every(row => selectedIds.has(row.ride_id))}
                  onChange={toggleCurrentPage} disabled={busy || !preview?.rows.length} />
              </th>
              {['BOOKING ID', 'TANGGAL', 'WAKTU', 'STATUS', 'CUSTOMER ID', 'KENDARAAN', 'JEMPUT', 'TUJUAN', 'VTAT', 'CTAT', 'NILAI', 'JARAK', 'RATING DRV', 'RATING CUST', 'PEMBAYARAN'].map(h => <th key={h}>{h}</th>)}
            </tr></thead>
            <tbody>
              {preview?.rows.map(r => (
                <tr key={r.ride_id}>
                  <td className="select-cell">
                    <input className="row-select" type="checkbox" aria-label={`Pilih booking ${r.booking_id}`}
                      checked={selectedIds.has(r.ride_id)} onChange={() => toggleSelectedRow(r.ride_id)} disabled={busy} />
                  </td>
                  <td className="booking-id">{r.booking_id}</td><td>{r.booking_date}</td><td>{fmt(r.booking_time)}</td>
                  <td>{r.booking_status}</td><td>{fmt(r.customer_id)}</td><td>{fmt(r.vehicle_type)}</td>
                  <td>{fmt(r.pickup_location)}</td><td>{fmt(r.drop_location)}</td>
                  <td>{fmt(r.avg_vtat, 1)}</td><td>{fmt(r.avg_ctat, 1)}</td>
                  <td className="fare">{fmt(r.booking_value, 0)}</td><td>{fmt(r.ride_distance, 2)}</td>
                  <td>{fmt(r.driver_rating, 1)}</td><td>{fmt(r.customer_rating, 1)}</td><td>{fmt(r.payment_method)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview && preview.rows.length === 0 && <div className="no-results">{preview.totalAll === 0 ? 'Belum ada dataset tersimpan. Unggah dan periksa CSV untuk melihat pratinjau.' : 'Tidak ada data yang cocok.'}</div>}
        </div>
        <div className="table-footer">
          <span>Menampilkan {from.toLocaleString('id-ID')}–{to.toLocaleString('id-ID')} dari {(preview?.total ?? 0).toLocaleString('id-ID')}</span>
          <div>
            <button className="pagination" disabled={page <= 1} onClick={() => setPage(1)}>Awal</button>
            <button className="pagination" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ArrowLeft size={12} /> Sebelumnya</button>
            <span className="page-indicator">Halaman {page.toLocaleString('id-ID')} / {lastPage.toLocaleString('id-ID')}</span>
            <button className="pagination" disabled={page >= lastPage} onClick={() => setPage(p => Math.min(lastPage, p + 1))}>Berikutnya <ArrowRight size={12} /></button>
            <button className="pagination" disabled={page >= lastPage} onClick={() => setPage(lastPage)}>Akhir</button>
          </div>
        </div>
      </section>
    </div>
  )
}
