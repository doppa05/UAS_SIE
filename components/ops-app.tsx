'use client'

import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowDown, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, BarChart3, CalendarDays, CarFront, Check, ChevronDown, CircleDollarSign, Clock3, Database, Eye, EyeOff, FileUp, Filter, Gauge, LayoutDashboard, Lightbulb, ListTree, Lock, LogOut, Search, ShieldCheck, TrendingUp, Upload, Users, X } from 'lucide-react'
import {
  DEFAULT_FILTERS, MONTHS, RANGES, STATUSES, STATUS_COLORS,
  fmtCompact, fmtInt, fmtPct, fmtRp, fmtRpCompact, niceMax, trend,
  type Agg, type Filters, type Range, type Row, type Status, type Trend,
} from '@/lib/data'

import { EtlWorkspace } from '@/components/etl-workspace'
import { useToast } from '@/components/ui/toast'
import { buildInsights, buildRecommendation, type InsightInput } from '@/lib/insights'

type Screen = 'LOGIN' | 'MAIN_MENU' | 'ETL_PAGE' | 'DASHBOARD'
type SortKey = 'id' | 'ts' | 'vehicle' | 'status' | 'payment' | 'fare'
type Tab = 'Ringkasan Eksekutif' | 'Analisis Pembatalan' | 'Analitik Pendapatan & Pelanggan' | 'Mesin Analisis Skenario' | 'Drill Down' | 'Detail Pemesanan'
type DrillDimension = 'tanggal' | 'kendaraan' | 'status' | 'pembayaran'
type DrillPathItem = { dimension: DrillDimension; value: string }
type DrillGroup = { value: string; total: number; completed: number; revenue: number; cancelled: number }
type DrilldownPayload = {
  path: DrillPathItem[]
  rowCount: number
  page: number
  totalRows: number
  latestDate: string
} & (
  | { level: DrillDimension; rows: DrillGroup[] }
  | { level: 'detail'; rows: Row[] }
)
const tabs: Tab[] = ['Ringkasan Eksekutif', 'Analisis Pembatalan', 'Analitik Pendapatan & Pelanggan', 'Mesin Analisis Skenario', 'Drill Down', 'Detail Pemesanan']
const PAGE_SIZE = 6
const DRILL_PAGE_SIZE = 12
const EMPTY_AGG: Agg = { total: 0, completed: 0, byStatus: STATUSES.map(() => 0), byVehicle: {}, payRev: [], revenue: 0, lost: STATUSES.map(() => 0), leak: 0, rating: 0, repeat: 0, avgFare: 0 }

type Series = { labels: string[]; tips: string[]; values: number[]; subtitle: string }
type DashboardPayload = {
  agg: Agg
  prev: Agg | null
  aggAllStatus: Agg
  aggAllVehicle: Agg
  aggAllPayment: Agg
  bookingSeries: Series
  revenueSeries: Series
  latestDate: string
  reasons: { label: string; value: number; status: string }[]
  rows: Row[]
  rowCount: number
  totalRows: number
  options: { vehicles: string[]; payments: string[] }
}

function Brand({ light = false }: { light?: boolean }) { return <div className={`brand ${light ? 'brand-light' : ''}`}><div className="brand-mark"><Activity size={20} strokeWidth={2.5} /></div><div><strong>UBER NCR</strong><span>INTELIJEN OPERASIONAL</span></div></div> }
function formatDateID(value: string) { const [year, month, day] = value.split('-'); return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}` }
function formatMonthID(value: string) { const [, year, month] = value.match(/^(\d{4})-(\d{2})/) ?? []; return month ? `${MONTHS[Number(month) - 1]} ${year}` : 'Belum ada data' }
function Button({ children, onClick, variant = 'primary', className = '', type = 'button', disabled = false }: { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost'; className?: string; type?: 'button' | 'submit'; disabled?: boolean }) { return <button type={type} onClick={onClick} disabled={disabled} className={`button button-${variant} ${className}`}>{children}</button> }

function Metric({ label, value, trend: t, icon: Icon, tone = 'blue', hint }: { label: string; value: string; trend: Trend | null; icon: typeof Activity; tone?: string; hint?: string }) {
  return (
    <article className="metric-card" data-tip={hint}>
      <div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div>
      <strong className="metric-value">{value}</strong>
      <div className="metric-foot">
        {t ? <><span className={t.good ? 'positive' : 'negative'}>{t.dir === 'down' ? <ArrowDownRight size={13} /> : <TrendingUp size={13} />}{t.text}</span><span>dibanding periode sebelumnya</span></> : <span>Tanpa periode pembanding</span>}
      </div>
    </article>
  )
}

type DonutItem = { key: string; label: string; value: number; color: string }
function Donut({ title, subtitle, items, centerLabel, selected, onSelect }: { title: string; subtitle: string; items: DonutItem[]; centerLabel: string; selected?: string; onSelect?: (key: string) => void }) {
  const [hov, setHov] = useState<string | null>(null)
  const total = items.reduce((s, i) => s + i.value, 0)
  const R = 42
  const C = 2 * Math.PI * R
  let off = 0
  const segs = items.filter(i => i.value > 0).map(i => { const len = total ? (i.value / total) * C : 0; const seg = { ...i, len, off }; off += len; return seg })
  const active = items.find(i => i.key === hov)
  return (
    <section className="panel">
      <div className="panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div></div>
      <div className="donut-layout">
        <div className="donut-wrap">
          <svg viewBox="0 0 100 100" className="donut-svg" role="img" aria-label={title}>
            <circle cx="50" cy="50" r={R} fill="none" stroke="#e2e8f0" strokeWidth="14" />
            {segs.map(sg => (
              <circle key={sg.key} cx="50" cy="50" r={R} fill="none" stroke={sg.color} strokeLinecap="butt"
                strokeWidth={hov === sg.key || selected === sg.key ? 18 : 14} strokeDasharray={`${Math.max(sg.len - (segs.length > 1 ? 0.6 : 0), 0)} ${C}`} strokeDashoffset={-sg.off} transform="rotate(-90 50 50)"
                opacity={hov && hov !== sg.key ? 0.35 : selected && selected !== 'all' && selected !== sg.key ? 0.4 : 1}
                className={onSelect ? 'donut-seg clickable' : 'donut-seg'} onMouseEnter={() => setHov(sg.key)} onMouseLeave={() => setHov(null)} onClick={() => onSelect?.(sg.key)} />
            ))}
          </svg>
          <div className="donut-center">
            <strong>{fmtCompact(active ? active.value : total)}</strong>
            <span>{active ? `${active.label} · ${total ? Math.round((active.value / total) * 100) : 0}%` : centerLabel}</span>
          </div>
        </div>
        <div className="legend">
          {items.map(i => (
            <button key={i.key} onMouseEnter={() => setHov(i.key)} onMouseLeave={() => setHov(null)} onClick={() => onSelect?.(i.key)} className={`legend-item ${onSelect ? '' : 'static'} ${selected === i.key ? 'selected' : selected && selected !== 'all' ? 'dim' : ''} ${hov === i.key ? 'hovered' : ''}`}>
              <i style={{ background: i.color }} />{i.label} <b>{total ? Math.round((i.value / total) * 100) : 0}%</b>
            </button>
          ))}
        </div>
      </div>
      <p className="chart-hint">{onSelect ? 'Arahkan kursor untuk rincian · klik segmen atau legenda untuk memfilter DASHBOARD' : 'Arahkan kursor pada segmen atau legenda untuk rincian'}</p>
    </section>
  )
}

function TrendChart({ title, series, fmt, fmtFull, badge }: { title: string; series: Series; fmt: (n: number) => string; fmtFull: (n: number) => string; badge: string }) {
  const { labels, tips, values, subtitle } = series
  const [hover, setHover] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const max = niceMax(Math.max(...values, 0))
  const n = values.length
  const sum = values.reduce((a, b) => a + b, 0)
  const avg = n ? sum / n : 0
  const hi = values.indexOf(Math.max(...values))
  const lo = values.indexOf(Math.min(...values))
  const focus = hover ?? pinned
  const diffText = (v: number) => { const d = avg ? ((v - avg) / avg) * 100 : 0; return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1).replace('.', ',')}% dari rata-rata` }
  return (
    <section className="panel">
      <div className="panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div><span className="tag">{badge}</span></div>
      <div className="chart-area">
        <div className="y-labels">{[1, 0.75, 0.5, 0.25, 0].map(t => <span key={t}>{t === 0 ? '0' : fmt(max * t)}</span>)}</div>
        <div className={`bar-chart ${focus !== null ? 'has-focus' : ''}`} style={{ gridTemplateColumns: `repeat(${n},1fr)`, gap: n > 12 ? '3px' : '8px' }} onMouseLeave={() => setHover(null)}>
          {values.map((v, i) => {
            const pct = (v / max) * 100
            const align = i < n * 0.15 ? 'tip-left' : i > n * 0.85 ? 'tip-right' : ''
            return (
              <div key={i} role="button" tabIndex={0} aria-label={`${tips[i]}: ${fmtFull(v)}`} aria-pressed={pinned === i}
                className={`bar-column ${focus === i ? 'is-focus' : ''} ${pinned === i ? 'is-pinned' : ''}`}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                onClick={() => setPinned(pinned === i ? null : i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinned(pinned === i ? null : i) } }}>
                {focus === i && <div className={`chart-tip ${align}`} style={{ bottom: `calc(${pct}% + 26px)` }}><span>{tips[i]}</span><strong>{fmtFull(v)}</strong><em>{diffText(v)}</em></div>}
                <div className={`bar ${i === n - 1 ? 'bar-active' : ''}`} style={{ height: `${pct}%` }} />
                <span>{labels[i]}</span>
              </div>
            )
          })}
          {avg > 0 && <div className="avg-line" style={{ bottom: `calc(19px + (100% - 19px) * ${avg / max})` }}><span>rata-rata</span></div>}
        </div>
      </div>
      <div className="chart-stats">
        <div><small>Rata-rata</small><b>{fmtFull(avg)}</b></div>
        <button onClick={() => setPinned(hi)}><small>Tertinggi · {tips[hi]}</small><b>{fmtFull(values[hi] ?? 0)}</b></button>
        <button onClick={() => setPinned(lo)}><small>Terendah · {tips[lo]}</small><b>{fmtFull(values[lo] ?? 0)}</b></button>
      </div>
      <p className="chart-hint">Arahkan kursor untuk detail · klik batang untuk menyematkan{pinned !== null && <> · <button className="link-btn" onClick={() => setPinned(null)}>lepas sematan</button></>}</p>
    </section>
  )
}

function Dashboard({ onBack, onLogout }: { onBack: () => void; onLogout: () => void }) {
  const notify = useToast()
  const [tab, setTab] = useState<Tab>(tabs[0])
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [reduction, setReduction] = useState(25)
  const [noDriver, setNoDriver] = useState(20)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'ts', dir: 'desc' })
  const [payload, setPayload] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [drillPath, setDrillPath] = useState<DrillPathItem[]>([])
  const [drillPage, setDrillPage] = useState(1)
  const [drillPayload, setDrillPayload] = useState<DrilldownPayload | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      range: filters.range,
      vehicle: filters.vehicle,
      status: filters.status,
      payment: filters.payment,
      search,
      page: String(page),
      sort: sort.key,
      direction: sort.dir,
    })
    setLoading(true)
    fetch(`/api/dashboard?${query}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Data DASHBOARD gagal dimuat.')
        return result as DashboardPayload
      })
      .then(result => { setPayload(result); setDataError('') })
      .catch(error => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : 'Data DASHBOARD gagal dimuat.'
          setDataError(message)
          notify({ kind: 'error', title: 'DASHBOARD gagal dimuat', text: message })
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filters, search, page, sort, notify])
  useEffect(() => {
    if (tab !== 'Drill Down') return
    const controller = new AbortController()
    const query = new URLSearchParams({
      range: filters.range,
      vehicle: filters.vehicle,
      status: filters.status,
      payment: filters.payment,
      page: String(drillPage),
    })
    for (const item of drillPath) {
      const key = ({ tanggal: 'drillDate', kendaraan: 'drillVehicle', status: 'drillStatus', pembayaran: 'drillPayment' } as const)[item.dimension]
      query.set(key, item.value)
    }
    setDrillLoading(true)
    fetch(`/api/dashboard/drilldown?${query}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Data drill down gagal dimuat.')
        return result as DrilldownPayload
      })
      .then(result => { setDrillPayload(result); setDrillError('') })
      .catch(error => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : 'Data drill down gagal dimuat.'
          setDrillError(message)
          notify({ kind: 'error', title: 'Rincian gagal dimuat', text: message })
        }
      })
      .finally(() => { if (!controller.signal.aborted) setDrillLoading(false) })
    return () => controller.abort()
  }, [tab, filters, drillPath, drillPage, notify])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setTab('Detail Pemesanan'); setTimeout(() => searchRef.current?.focus(), 60) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const sortBy = (k: SortKey) => { setSort(c => (c.key === k ? { key: k, dir: c.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'fare' || k === 'ts' ? 'desc' : 'asc' })); setPage(1) }

  const update = (patch: Partial<Filters>) => {
    setFilters(f => ({ ...f, ...patch }))
    setPage(1)
    setDrillPath([])
    setDrillPage(1)
  }
  const toggle = (k: 'vehicle' | 'status' | 'payment', v: string) => update({ [k]: filters[k] === v ? 'all' : v } as Partial<Filters>)

  const agg = payload?.agg ?? EMPTY_AGG
  const prev = payload?.prev ?? null
  const aggAllStatus = payload?.aggAllStatus ?? EMPTY_AGG
  const aggAllVehicle = payload?.aggAllVehicle ?? EMPTY_AGG
  const aggAllPayment = payload?.aggAllPayment ?? EMPTY_AGG
  const bookingSeries = payload?.bookingSeries ?? { labels: [], tips: [], values: [], subtitle: 'Memuat data...' }
  const revenueSeries = payload?.revenueSeries ?? { labels: [], tips: [], values: [], subtitle: 'Memuat data...' }
  const rows = payload?.rows ?? []
  const rowCount = payload?.rowCount ?? 0

  const chips: { key: keyof Filters; label: string }[] = []
  if (filters.range !== DEFAULT_FILTERS.range) chips.push({ key: 'range', label: filters.range })
  if (filters.vehicle !== 'all') chips.push({ key: 'vehicle', label: filters.vehicle })
  if (filters.status !== 'all') chips.push({ key: 'status', label: filters.status })
  if (filters.payment !== 'all') chips.push({ key: 'payment', label: filters.payment })
  const hasFilter = chips.length > 0
  const filterText = [filters.range.toLowerCase(), ...chips.filter(c => c.key !== 'range').map(c => c.label)].join(' · ')

  const completion = agg.total ? agg.completed / agg.total : 0
  const prevCompletion = prev && prev.total ? prev.completed / prev.total : null
  const cancelled = agg.byStatus[1] + agg.byStatus[2]
  const recoverDriver = (agg.lost[1] * reduction) / 100
  const recoverNoDriver = (agg.lost[3] * noDriver) / 100
  const recoverTotal = recoverDriver + recoverNoDriver
  const pageCount = Math.max(1, Math.ceil(rowCount / PAGE_SIZE))
  const pageRows = rows

  const statusItems: DonutItem[] = STATUSES.map((s, i) => ({ key: s, label: s === 'Pengemudi tidak ditemukan' ? 'Pengemudi tidak ditemukan' : s, value: aggAllStatus.byStatus[i], color: STATUS_COLORS[i] }))
  const compositionItems: DonutItem[] = STATUSES.slice(1).map((s, i) => ({ key: s, label: s, value: agg.byStatus[i + 1], color: STATUS_COLORS[i + 1] }))
  const reasons = payload?.reasons ?? []
  const vehicleRates = (payload?.options.vehicles ?? []).map(v => { const x = aggAllVehicle.byVehicle[v] ?? STATUSES.map(() => 0); const t = x.reduce((s, n) => s + n, 0); return { v, t, c: x[1] + x[2], rate: t ? (x[1] + x[2]) / t : 0 } })
  const maxRate = Math.max(...vehicleRates.map(r => r.rate), 0.0001)
  const topVehicle = vehicleRates.reduce((a, b) => (b.rate > a.rate ? b : a), { v: '—', t: 0, c: 0, rate: 0 })
  const payTotal = aggAllPayment.payRev.reduce((s, n) => s + n, 0)
  const rangeBadge = filters.range
  const insightInput: InsightInput = { agg, prev, aggAllVehicle, aggAllPayment, vehicles: payload?.options.vehicles ?? [], payments: payload?.options.payments ?? [], reasons, bookingSeries, range: filters.range, filterText }
  const insights = payload ? buildInsights(insightInput) : []
  const recommendation = payload ? buildRecommendation(insightInput) : null

  return (
    <div className="dashboard-shell" aria-busy={loading}>
      <aside className="sidebar">
        <Brand />
        <div className="side-label">RUANG KERJA</div>
        <button className="side-link active"><LayoutDashboard size={17} /> DASHBOARD eksekutif</button>
        <div className="side-label side-label-spaced">MANAJEMEN DATA</div>
        <button className="side-link" onClick={onBack}><Database size={17} /> Data &amp; ETL</button>
        <div className="sidebar-bottom">
          <div className="secure-note"><ShieldCheck size={16} /><div><strong>Ruang kerja aman</strong><span>Data dilindungi &amp; dienkripsi</span></div></div>
          <button className="profile" onClick={onLogout}><span className="avatar">AN</span><span className="profile-copy"><strong>Tim analitik</strong><small>Administrator</small></span><LogOut size={16} /></button>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="topbar">
          <div className="breadcrumbs"><span>Ruang kerja</span><span>/</span><strong>DASHBOARD eksekutif</strong></div>
          <div className="top-actions"><span className="live"><i /> Data langsung</span><span className="top-date"><CalendarDays size={15} /> {payload?.latestDate ? formatDateID(payload.latestDate) : '—'}</span><button className="top-avatar" aria-label="Profil pengguna">AN</button></div>
        </header>
        <div className="dashboard-content">
          <div className="page-title-row">
            <div><div className="eyebrow">RINGKASAN OPERASIONAL <span>•</span> DATA TERAKHIR {payload?.latestDate ? formatDateID(payload.latestDate) : '?'}</div><h1>DASHBOARD eksekutif</h1><p>Pantau kinerja dan temukan peluang di seluruh armada Anda.</p></div>
            <Button variant="secondary" onClick={onBack}><ArrowLeft size={16} /> Kembali ke menu utama</Button>
          </div>

          <section className="filter-bar">
            <div className="filter-label"><Filter size={16} /><span>Filter</span></div>
            <label className="filter-control"><span>Rentang tanggal</span>
              <select value={filters.range} onChange={e => update({ range: e.target.value as Range })}>{RANGES.map(r => <option key={r}>{r}</option>)}</select><ChevronDown size={13} /></label>
            <label className="filter-control"><span>Jenis kendaraan</span>
              <select value={filters.vehicle} onChange={e => update({ vehicle: e.target.value as Filters['vehicle'] })}><option value="all">Semua kendaraan</option>{(payload?.options.vehicles ?? []).map(v => <option key={v}>{v}</option>)}</select><ChevronDown size={13} /></label>
            <label className="filter-control"><span>Status pesanan</span>
              <select value={filters.status} onChange={e => update({ status: e.target.value as Filters['status'] })}><option value="all">Semua status</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select><ChevronDown size={13} /></label>
            <label className="filter-control"><span>Metode pembayaran</span>
              <select value={filters.payment} onChange={e => update({ payment: e.target.value as Filters['payment'] })}><option value="all">Semua metode</option>{(payload?.options.payments ?? []).map(p => <option key={p}>{p}</option>)}</select><ChevronDown size={13} /></label>
            <button className="clear-filter" disabled={!hasFilter} onClick={() => update(DEFAULT_FILTERS)}>Hapus semua</button>
          </section>
          <div className="filter-summary">
            <div className="chips">
              {chips.map(c => <button key={c.key} className="chip" onClick={() => update({ [c.key]: DEFAULT_FILTERS[c.key] } as Partial<Filters>)} aria-label={`Hapus filter ${c.label}`}>{c.label}<X size={11} /></button>)}
              {!hasFilter && <span className="chip-empty">Tidak ada filter tambahan · menampilkan {filters.range.toLowerCase()}</span>}
            </div>
            <span className="summary-count"><b>{fmtInt(agg.total)}</b> pemesanan sesuai filter</span>
          </div>
          {dataError && <div className="locked-notice" role="alert"><X size={16}/><span>{dataError}</span><button onClick={onLogout}>Kembali ke login</button></div>}

          <nav className="tabs" aria-label="Halaman DASHBOARD">{tabs.map((t, i) => <button key={t} className={`tab ${tab === t ? 'tab-active' : ''}`} onClick={() => setTab(t)}><span className="tab-number">0{i + 1}</span>{t}</button>)}</nav>

          {tab === 'Ringkasan Eksekutif' && <>
            <div className="metrics-grid">
              <Metric label="Tingkat penyelesaian" value={fmtPct(completion)} trend={trend(completion, prevCompletion, { rate: true })} icon={Check} hint={prev ? `Periode sebelumnya: ${fmtPct(prevCompletion ?? 0)}` : undefined} />
              <Metric label="Total pemesanan" value={fmtInt(agg.total)} trend={trend(agg.total, prev?.total)} icon={CarFront} tone="teal" hint={prev ? `Periode sebelumnya: ${fmtInt(prev.total)}` : undefined} />
              <Metric label="Pendapatan kotor" value={fmtRp(agg.revenue)} trend={trend(agg.revenue, prev?.revenue)} icon={CircleDollarSign} tone="purple" hint={prev ? `Periode sebelumnya: ${fmtRp(prev.revenue)}` : undefined} />
              <Metric label="Kebocoran pendapatan" value={fmtRp(agg.leak)} trend={trend(agg.leak, prev?.leak, { lowerIsBetter: true })} icon={ArrowDownRight} tone="orange" hint={prev ? `Periode sebelumnya: ${fmtRp(prev.leak)}` : undefined} />
            </div>
            <div className="charts-grid">
              <Donut title="Status pemesanan" subtitle="Rincian berdasarkan hasil pemesanan" items={statusItems} centerLabel="pemesanan" selected={filters.status} onSelect={k => toggle('status', k)} />
              <TrendChart title="Volume pemesanan" series={bookingSeries} fmt={fmtCompact} fmtFull={n => `${fmtInt(n)} pemesanan`} badge={rangeBadge} />
            </div>
            {insights.length > 0 && <section className="panel insights-panel" aria-label="Insight otomatis">
              <div className="panel-heading"><div><h3><Lightbulb size={14} /> Insight otomatis</h3><p>Temuan utama dari data pada {filterText}</p></div><span className="tag">{insights.length} temuan</span></div>
              <div className="insight-grid">
                {insights.map(item => {
                  const Icon = item.tone === 'good' ? Check : item.tone === 'warn' ? ArrowDownRight : Activity
                  const body = <><span className={`insight-badge ${item.tone}`}><Icon size={15} /></span><div><strong>{item.title}</strong><p>{item.text}</p></div></>
                  return item.tab
                    ? <button key={item.id} className={`insight-card ${item.tone} clickable`} onClick={() => setTab(item.tab as Tab)} title={`Buka ${item.tab}`}>{body}</button>
                    : <div key={item.id} className={`insight-card ${item.tone}`}>{body}</div>
                })}
              </div>
              {recommendation && <p className="insight-reco"><Lightbulb size={13} /> {recommendation}</p>}
            </section>}
            <div className="insight-strip"><span className="insight-icon"><Gauge size={17} /></span>
              <div><strong>{agg.lost[1] > 0 ? 'Peluang teridentifikasi' : 'Tidak ada peluang pada filter ini'}</strong>
                <p>{agg.lost[1] > 0 ? <>Menurunkan pembatalan oleh pengemudi sebesar 10% dapat memulihkan sekitar <b>{fmtRp(agg.lost[1] * 0.1)}</b> pendapatan pada {filterText}.</> : <>Tidak ada pembatalan oleh pengemudi pada kombinasi filter ini. Ubah filter untuk melihat peluang pemulihan.</>}</p></div>
              <button onClick={() => setTab('Mesin Analisis Skenario')}>Jelajahi skenario <ArrowRight size={14} /></button></div>
          </>}

          {tab === 'Analisis Pembatalan' && <div className="analysis-grid">
            <section className="panel">
              <div className="panel-heading"><div><h3>Alasan pembatalan</h3><p>Porsi dari seluruh pemesanan yang dibatalkan</p></div><span className="tag">{rangeBadge}</span></div>
              {cancelled === 0 ? <div className="empty-state">Tidak ada pembatalan pada kombinasi filter ini.</div> : reasons.map(r => (
                <button data-tip={`${fmtInt(r.value)} pembatalan · ${fmtPct(r.value / cancelled)} dari total`} className={`reason-row clickable ${filters.status === r.status ? 'selected' : ''}`} key={r.label} onClick={() => toggle('status', r.status)}>
                  <div className="reason-meta"><span>{r.label}</span><b>{fmtPct(r.value / cancelled, 0)}</b></div>
                  <div className="reason-track"><i style={{ width: `${(r.value / reasons[0].value) * 100}%` }} /></div>
                </button>
              ))}
              {cancelled > 0 && <p className="chart-hint">Klik alasan untuk memfilter menurut jenis pembatalan</p>}
            </section>
            <section className="panel">
              <div className="panel-heading"><div><h3>Tingkat pembatalan per kendaraan</h3><p>Pembatalan oleh pengemudi &amp; pelanggan</p></div></div>
              {vehicleRates.map(({ v, t, c, rate }) => (
                <button key={v} data-tip={`${fmtInt(t)} pemesanan · ${fmtInt(c)} dibatalkan`} className={`vehicle-row clickable ${filters.vehicle === v ? 'selected' : filters.vehicle !== 'all' ? 'dim' : ''}`} onClick={() => toggle('vehicle', v)}>
                  <span className="vehicle-icon"><CarFront size={16} /></span><span className="vehicle-name">{v}</span>
                  <div className="vehicle-track"><i style={{ width: `${(rate / maxRate) * 100}%` }} /></div><b>{fmtPct(rate)}</b>
                </button>
              ))}
              <div className="callout"><ArrowDownRight size={17} /><span>{topVehicle.v} memiliki tingkat pembatalan tertinggi sebesar <b>{fmtPct(topVehicle.rate)}</b>. Klik baris untuk memfilter.</span></div>
            </section>
            <Donut title="Komposisi pembatalan" subtitle="Pemesanan yang tidak selesai menurut penyebab" items={compositionItems} centerLabel="tidak selesai" />
          </div>}

          {tab === 'Analitik Pendapatan & Pelanggan' && <>
            <div className="metrics-grid three">
              <Metric label="Rata-rata nilai pemesanan" value={agg.completed ? fmtRp(agg.avgFare) : '–'} trend={trend(agg.avgFare, prev?.avgFare)} icon={CircleDollarSign} hint={prev ? `Periode sebelumnya: ${fmtRp(prev.avgFare)}` : undefined} />
              <Metric label="Rata-rata rating pelanggan" value={agg.completed ? `${agg.rating.toFixed(2).replace('.', ',')} / 5` : '–'} trend={trend(agg.rating, prev?.rating)} icon={Users} tone="teal" hint={prev ? `Periode sebelumnya: ${prev.rating.toFixed(2).replace('.', ',')} / 5` : undefined} />
              <Metric label="Tingkat pelanggan berulang" value={fmtPct(agg.repeat)} trend={trend(agg.repeat, prev?.repeat, { rate: true })} icon={Activity} tone="purple" hint={prev ? `Periode sebelumnya: ${fmtPct(prev.repeat)}` : undefined} />
            </div>
            <div className="charts-grid">
              <TrendChart title="Tren pendapatan" series={revenueSeries} fmt={fmtRpCompact} fmtFull={fmtRp} badge={rangeBadge} />
              <section className="panel">
                <div className="panel-heading"><div><h3>Pendapatan per metode pembayaran</h3><p>Kontribusi terhadap pendapatan kotor</p></div></div>
                <div className="payment-total">{fmtRp(payTotal)} <span>total pendapatan · klik baris untuk memfilter</span></div>
                {(payload?.options.payments ?? []).map((p, i) => (
                  <button key={p} data-tip={`${fmtPct(payTotal ? aggAllPayment.payRev[i] / payTotal : 0)} dari pendapatan kotor`} className={`reason-row clickable ${filters.payment === p ? 'selected' : filters.payment !== 'all' ? 'dim' : ''}`} onClick={() => toggle('payment', p)}>
                    <div className="reason-meta"><span>{p}</span><b>{fmtRp(aggAllPayment.payRev[i])}</b></div>
                    <div className="reason-track"><i style={{ width: `${payTotal ? (aggAllPayment.payRev[i] / payTotal) * 100 : 0}%` }} /></div>
                  </button>
                ))}
              </section>
            </div>
          </>}

          {tab === 'Mesin Analisis Skenario' && <>
            <div className="scenario-intro"><div><span className="eyebrow">PERENCANA SKENARIO</span><h2>Modelkan peluang pemulihan Anda</h2><p>Sesuaikan asumsi di bawah untuk memperkirakan potensi pemulihan pendapatan.</p></div><span className="scenario-badge"><Activity size={15} /> Model interaktif</span></div>
            <div className="scenario-grid">
              <section className="panel scenario-controls">
                <h3>Asumsi skenario</h3><p>Geser penggeser atau pilih skenario siap pakai.</p>
                <div className="preset-row">{([['Konservatif', 10, 10], ['Moderat', 25, 20], ['Agresif', 40, 35]] as [string, number, number][]).map(([n, r, d]) => <button key={n} className={`preset ${reduction === r && noDriver === d ? 'active' : ''}`} onClick={() => { setReduction(r); setNoDriver(d) }}>{n}<small>{r}% · {d}%</small></button>)}</div>
                <label className="range-label"><span>Penurunan pembatalan oleh pengemudi</span><b>{reduction}%</b></label>
                <input type="range" min="0" max="60" value={reduction} onChange={e => setReduction(Number(e.target.value))} />
                <div className="range-hints"><span>0%</span><span>60%</span></div>
                <label className="range-label range-second"><span>Penurunan “Pengemudi tidak ditemukan”</span><b>{noDriver}%</b></label>
                <input type="range" min="0" max="60" value={noDriver} onChange={e => setNoDriver(Number(e.target.value))} />
                <div className="range-hints"><span>0%</span><span>60%</span></div>
                <div className="assumption-note"><Clock3 size={15} /> Berdasarkan data pemesanan: {filterText}.</div>
              </section>
              <section className="potential-card">
                <div className="potential-top"><span>ESTIMASI PEMULIHAN PENDAPATAN</span><span className="potential-icon"><TrendingUp size={18} /></span></div>
                <strong>{fmtRp(recoverTotal)}</strong><p>Potensi pendapatan yang dipulihkan</p>
                <div className="potential-divider" />
                <div className="potential-foot"><span>Diperbarui secara waktu nyata</span><span className="positive"><TrendingUp size={13} />+{agg.revenue ? ((recoverTotal / agg.revenue) * 100).toFixed(1).replace('.', ',') : '0,0'}% dari pendapatan</span></div>
              </section>
            </div>
            <div className="charts-grid">
              <TrendChart title="Tren pendapatan" series={revenueSeries} fmt={fmtRpCompact} fmtFull={fmtRp} badge={rangeBadge} />
              <section className="panel">
                <div className="panel-heading"><div><h3>Rincian pemulihan</h3><p>Estimasi nilai per faktor · {rangeBadge}</p></div></div>
                <div className="breakdown-item"><span className="break-dot blue-dot" /><span>Penurunan pembatalan oleh pengemudi</span><b>{fmtRp(recoverDriver)}</b></div>
                <div className="breakdown-item"><span className="break-dot teal-dot" /><span>Penurunan “pengemudi tidak ditemukan”</span><b>{fmtRp(recoverNoDriver)}</b></div>
                <div className="breakdown-item"><span className="break-dot" style={{ background: '#cbd5e1' }} /><span>Pendapatan hilang tersisa (semua penyebab)</span><b>{fmtRp(Math.max(agg.leak - recoverTotal, 0))}</b></div>
              </section>
            </div>
          </>}

          {tab === 'Drill Down' && <section className="panel drill-panel">
            <div className="panel-heading drill-heading">
              <div><h3><ListTree size={17} /> Telusuri pemesanan secara bertahap</h3><p>Drill down dari tanggal ke kendaraan, status, pembayaran, lalu detail transaksi.</p></div>
              <span className="tag">{rangeBadge}</span>
            </div>
            <nav className="drill-breadcrumbs" aria-label="Jalur drill down">
              <button className={drillPath.length === 0 ? 'current' : ''} onClick={() => { setDrillPath([]); setDrillPage(1) }}>Semua pemesanan</button>
              {drillPath.map((item, index) => (
                <span key={item.dimension}>
                  <ArrowRight size={13} />
                  <button className={index === drillPath.length - 1 ? 'current' : ''} onClick={() => { setDrillPath(drillPath.slice(0, index + 1)); setDrillPage(1) }}>
                    {item.dimension === 'tanggal' ? formatDateID(item.value) : item.value}
                  </button>
                </span>
              ))}
            </nav>
            {drillError && <div className="locked-notice" role="alert"><X size={16} /><span>{drillError}</span></div>}
            <div className="drill-summary">
              <div><span>Cakupan data</span><strong>{fmtInt(drillPayload?.totalRows ?? 0)} pemesanan</strong></div>
              <div><span>{drillPayload?.level === 'detail' ? 'Pemesanan ditemukan' : `Kelompok ${drillPayload?.level ?? 'tanggal'}`}</span><strong>{fmtInt(drillPayload?.rowCount ?? 0)}</strong></div>
              {drillPath.length > 0 && <button className="clear-filter" onClick={() => { setDrillPath([]); setDrillPage(1) }}>Reset drill down</button>}
            </div>
            {drillLoading && <div className="empty-state">Memuat rincian data...</div>}
            {!drillLoading && drillPayload?.level !== 'detail' && drillPayload && (
              <>
                <div className="table-wrap drill-table-wrap">
                  <table className="drill-table">
                    <thead><tr><th>{({ tanggal: 'TANGGAL', kendaraan: 'JENIS KENDARAAN', status: 'STATUS PEMESANAN', pembayaran: 'METODE PEMBAYARAN' } as const)[drillPayload.level]}</th><th>PEMESANAN</th><th>SELESAI</th><th>DIBATALKAN / TIDAK SELESAI</th><th>PENDAPATAN KOTOR</th><th /></tr></thead>
                    <tbody>{drillPayload.rows.map(group => (
                      <tr key={group.value}>
                        <td><button className="drill-open" onClick={() => { setDrillPath([...drillPath, { dimension: drillPayload.level, value: group.value }]); setDrillPage(1) }}>
                          <span>{drillPayload.level === 'tanggal' ? formatDateID(group.value) : group.value}</span><small>Telusuri rincian</small>
                        </button></td>
                        <td>{fmtInt(group.total)}</td><td>{fmtInt(group.completed)} <small>({fmtPct(group.total ? group.completed / group.total : 0)})</small></td>
                        <td>{fmtInt(group.cancelled)}</td><td className="fare">{fmtRp(group.revenue)}</td>
                        <td><button className="drill-arrow" aria-label={`Telusuri ${group.value}`} onClick={() => { setDrillPath([...drillPath, { dimension: drillPayload.level, value: group.value }]); setDrillPage(1) }}><ArrowRight size={15} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {drillPayload.rows.length === 0 && <div className="no-results">Tidak ada kelompok pemesanan pada filter ini.</div>}
                </div>
                <div className="table-footer"><span>Menampilkan {drillPayload.rowCount ? (drillPage - 1) * DRILL_PAGE_SIZE + 1 : 0}–{Math.min(drillPage * DRILL_PAGE_SIZE, drillPayload.rowCount)} dari {fmtInt(drillPayload.rowCount)} kelompok</span>
                  <div><button className="pagination" onClick={() => setDrillPage(Math.max(1, drillPage - 1))} disabled={drillPage === 1}>Sebelumnya</button><button className="pagination" onClick={() => setDrillPage(drillPage + 1)} disabled={drillPage >= Math.ceil(drillPayload.rowCount / DRILL_PAGE_SIZE)}>Berikutnya <ArrowRight size={13} /></button></div></div>
              </>
            )}
            {!drillLoading && drillPayload?.level === 'detail' && (
              <>
                <div className="table-wrap drill-table-wrap">
                  <table className="drill-table">
                    <thead><tr><th>ID PEMESANAN</th><th>TANGGAL &amp; WAKTU</th><th>RUTE</th><th>STATUS</th><th>PEMBAYARAN</th><th>TARIF</th></tr></thead>
                    <tbody>{drillPayload.rows.map(row => <tr key={row.key}><td className="booking-id">{row.id}</td><td>{row.date}</td><td><span className="route-cell">{row.pickup}<small>ke {row.dropoff}</small></span></td><td><span className={`status status-${row.tone}`}>{row.status}</span></td><td>{row.payment}</td><td className="fare">Rp {fmtInt(row.fare)}</td></tr>)}</tbody>
                  </table>
                  {drillPayload.rows.length === 0 && <div className="no-results">Tidak ada detail pemesanan yang sesuai.</div>}
                </div>
                <div className="table-footer"><span>Menampilkan {drillPayload.rowCount ? (drillPage - 1) * DRILL_PAGE_SIZE + 1 : 0}–{Math.min(drillPage * DRILL_PAGE_SIZE, drillPayload.rowCount)} dari {fmtInt(drillPayload.rowCount)} pemesanan</span>
                  <div><button className="pagination" onClick={() => setDrillPage(Math.max(1, drillPage - 1))} disabled={drillPage === 1}>Sebelumnya</button><button className="pagination" onClick={() => setDrillPage(drillPage + 1)} disabled={drillPage >= Math.ceil(drillPayload.rowCount / DRILL_PAGE_SIZE)}>Berikutnya <ArrowRight size={13} /></button></div></div>
              </>
            )}
          </section>}

          {tab === 'Detail Pemesanan' && <section className="panel table-panel">
            <div className="table-heading"><div><h3>Transaksi pemesanan</h3><p>Tinjau catatan pemesanan satu per satu</p></div>
              <label className="search-box"><Search size={16} /><input ref={searchRef} aria-label="Cari berdasarkan ID pemesanan" placeholder="Cari ID pemesanan..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} /><kbd>Ctrl/⌘ K</kbd></label></div>
            <div className="table-wrap">
              <table>
                <thead><tr>{([['id', 'ID PEMESANAN'], ['ts', 'TANGGAL & WAKTU'], ['vehicle', 'KENDARAAN'], [null, 'RUTE'], ['status', 'STATUS'], ['payment', 'PEMBAYARAN'], ['fare', 'TARIF']] as [SortKey | null, string][]).map(([k, l]) => k ? <th key={l} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}><button className={`th-sort ${sort.key === k ? 'on' : ''}`} onClick={() => sortBy(k)}>{l}{sort.key === k ? (sort.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}</button></th> : <th key={l}>{l}</th>)}</tr></thead>
                <tbody>{pageRows.map(b => <tr key={b.key}><td className="booking-id">{b.id}</td><td>{b.date}</td><td>{b.vehicle}</td><td><span className="route-cell">{b.pickup}<small>ke {b.dropoff}</small></span></td><td><span className={`status status-${b.tone}`}>{b.status}</span></td><td>{b.payment}</td><td className="fare">Rp {fmtInt(b.fare)}</td></tr>)}</tbody>
              </table>
              {rowCount === 0 && <div className="no-results">{search ? <>Tidak ada pemesanan ditemukan untuk “{search}”.</> : 'Tidak ada pemesanan pada kombinasi filter ini.'}</div>}
            </div>
            <div className="table-footer"><span>Menampilkan {rowCount ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, rowCount)} dari {fmtInt(rowCount)} pemesanan · total {fmtInt(agg.total)} pemesanan sesuai filter</span>
              <div><button className="pagination" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>Sebelumnya</button><button className="pagination" onClick={() => setPage(page + 1)} disabled={page >= pageCount}>Berikutnya <ArrowRight size={13} /></button></div></div>
          </section>}

          <footer className="dashboard-footer"><span>Sistem Diagnostik Operasional &amp; Pendapatan UBER NCR</span><span>Data diperbarui melalui proses ETL <i /> Semua sistem beroperasi normal</span></footer>
        </div>
      </main>
    </div>
  )
}

export function OpsApp() {
 const notify = useToast()
 const [screen, setScreen] = useState<Screen>('LOGIN')
 const [etlDone, setEtlDone] = useState(false)
 const [lockedNotice, setLockedNotice] = useState(false)
 const [showPw, setShowPw] = useState(false)
 const [forgot, setForgot] = useState(false)
 const [userMenu, setUserMenu] = useState(false)
 const [authError, setAuthErrorState] = useState('')
 const [submitting, setSubmitting] = useState(false)
 const [summary, setSummary] = useState<{ agg: Agg; prev: Agg | null } | null>(null)
 const [latestDate, setLatestDate] = useState('')
 const setAuthError = (message: string) => {
   setAuthErrorState(message)
   if (message) notify({ kind: 'error', title: 'Validasi login', text: message })
 }
 const loadSession = async () => {
   const response = await fetch('/api/auth/session')
   if (response.status === 401) return null
   const result = await response.json()
   if (!response.ok) throw new Error(result.error || 'Sesi admin gagal dimuat.')
   if (!result.authenticated) return null
   setSummary(result.summary)
   setLatestDate(result.latestDate)
   setEtlDone(result.rowCount > 0)
   return result as { username: string; rowCount: number; latestDate: string; summary: { agg: Agg; prev: Agg | null } }
 }
 useEffect(() => {
   loadSession().then(result => { if (result) setScreen('MAIN_MENU') })
     .catch(error => setAuthError(error instanceof Error ? error.message : 'Sesi admin gagal dimuat.'))
 }, [])
 const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
   event.preventDefault()
   const loginForm = event.currentTarget
   setSubmitting(true)
   setAuthError('')
   try {
     const form = new FormData(loginForm)
     const response = await fetch('/api/auth/login', {
       method: 'POST', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
     })
     const result = await response.json()
     if (!response.ok) throw new Error(result.error || 'Login gagal.')
     const session = await loadSession()
     if (!session) throw new Error('Sesi login tidak dapat dibuat.')
     setScreen('MAIN_MENU')
   } catch (error) {
     setAuthError(error instanceof Error ? error.message : 'Login gagal.')
   } finally {
     setSubmitting(false)
   }
 }
 const openDashboard = () => {
   if (etlDone) { setLockedNotice(false); setScreen('DASHBOARD') }
   else {
     setLockedNotice(true)
     notify({ kind: 'error', title: 'DASHBOARD belum tersedia', text: 'Unggah dan simpan dataset melalui ETL terlebih dahulu.' })
   }
 }
 const resetEtl = () => { setLockedNotice(false) }
 const handleLogout = async () => {
   await fetch('/api/auth/logout', { method: 'POST' })
   resetEtl()
   setSummary(null)
   setLatestDate('')
   setUserMenu(false)
   setScreen('LOGIN')
 }
 const view = screen === 'DASHBOARD' && !etlDone ? 'MAIN_MENU' : screen
 if (view === 'LOGIN') return <main className="login-screen"><div className="login-side"><Brand light/><div className="login-message"><div className="login-overline">INTELIJEN OPERASIONAL</div><h1>Keputusan lebih baik<br/>berawal dari <em>kejelasan.</em></h1><p>Satu tampilan terpadu untuk operasional perjalanan, pengalaman pelanggan, dan kinerja pendapatan di seluruh NCR.</p><div className="login-stats"><div><strong>128 rb+</strong><span>Pemesanan per bulan</span></div><div><strong>6 tampilan</strong><span>Wawasan siap pakai</span></div></div></div><div className="login-side-bottom">PLATFORM ANALITIK INTERNAL <span>•</span> WILAYAH NCR</div></div><div className="login-form-side"><div className="login-mobile-brand"><Brand/></div><div className="login-form-wrap"><div className="welcome-mark"><Activity size={21}/></div><span className="eyebrow">SELAMAT DATANG KEMBALI</span><h2>Masuk ke ruang kerja Anda</h2><p>Akses DASHBOARD kinerja operasional Anda.</p><form onSubmit={handleLogin}><label>Nama pengguna<input name="username" type="text" placeholder="admin" defaultValue="admin" required autoComplete="username"/></label><label>Kata sandi<span className="pw-wrap"><input name="password" type={showPw?'text':'password'} placeholder="Masukkan kata sandi Anda" required autoComplete="current-password"/><button type="button" className="pw-toggle" aria-label={showPw?'Sembunyikan kata sandi':'Tampilkan kata sandi'} onClick={()=>setShowPw(v=>!v)}>{showPw?<EyeOff size={16}/>:<Eye size={16}/>}</button></span></label><div className="login-row"><label className="remember"><input type="checkbox"/> Ingat saya</label><button type="button" className="text-link" onClick={()=>setForgot(v=>!v)}>Lupa kata sandi?</button></div>{forgot&&<p className="login-notice">Hubungi administrator sistem untuk mengatur ulang kata sandi Anda.</p>}{authError&&<p className="login-notice" role="alert">{authError}</p>}<Button type="submit" className="full-button" disabled={submitting}>Masuk ke Sistem <ArrowRight size={16}/></Button></form><div className="login-secure"><ShieldCheck size={15}/> Akun awal: admin / admin123</div></div><div className="login-footer">© 2024 Operasional Uber NCR <span>Bantuan &amp; dukungan</span></div></div></main>
 if (view === 'MAIN_MENU') return <main className="menu-screen"><header className="menu-header"><Brand/><div className="menu-user-wrap"><button className="menu-user" aria-expanded={userMenu} onClick={()=>setUserMenu(v=>!v)}><span className="avatar">AN</span><span><strong>Tim analitik</strong><small>Administrator</small></span><ChevronDown size={15}/></button>{userMenu&&<div className="user-pop"><button onClick={handleLogout}><LogOut size={14}/> Keluar</button></div>}</div></header><section className="menu-hero"><div className="hero-copy"><span className="eyebrow"><i/> PLATFORM INTELIJEN OPERASIONAL</span><h1>Sistem Diagnostik Eksekutif Operasional &amp; Pendapatan UBER NCR</h1><p>Platform analitik terpadu untuk memahami performa perjalanan, menganalisis kebocoran pendapatan, dan mengidentifikasi peluang peningkatan operasional.</p><div className="hero-meta"><span><CalendarDays size={15}/> Laporan terbaru: {formatMonthID(latestDate)}</span><span><ShieldCheck size={15}/> Data diperbarui secara berkala</span></div></div><div className="hero-visual"><div className="visual-card"><div className="visual-head"><span>RINGKASAN KINERJA</span><span className="live"><i/> LANGSUNG</span></div><div className="snapshot-number"><strong>{fmtPct((summary?.agg.completed ?? 0)/(summary?.agg.total || 1),0)}</strong><span>Tingkat penyelesaian</span></div><div className="snapshot-bars">{[34,45,40,58,52,68,60,82,70,93,78,100].map((v,i)=><i key={i} data-tip={`${MONTHS[i]} 2024 · ${v}% dari puncak`} style={{height:`${v}%`}}/>)}</div><div className="snapshot-foot"><span>Penyelesaian pemesanan</span><span className="positive">{(trend((summary?.agg.completed ?? 0)/(summary?.agg.total || 1), summary?.prev && summary.prev.total ? summary.prev.completed/summary.prev.total : null, {rate:true})?.text ?? '?')} <TrendingUp size={13}/></span></div></div><div className="hero-float"><span className="float-icon"><CircleDollarSign size={16}/></span><div><small>Pendapatan berisiko</small><strong>{fmtRp((summary?.agg.leak ?? 0))}</strong></div><ArrowDownRight size={17}/></div></div></section><div className="menu-section-heading"><div><span className="eyebrow">RUANG KERJA ANDA</span><h2>Pilih untuk memulai</h2><p>Siapkan data Anda atau jelajahi wawasan terbaru.</p></div><span className="workspace-status"><i/> RUANG KERJA SIAP</span></div><section className="workspace-cards"><button className="workspace-card" onClick={()=>setScreen('ETL_PAGE')}><div className="workspace-icon blue-icon"><Database size={21}/></div><div className="workspace-card-top"><span className="eyebrow">MANAJEMEN DATA</span><ArrowRight size={17}/></div><h3>ETL</h3><p>Unggah dataset perjalanan dan jalankan proses validasi serta transformasi data.</p><div className="card-bottom"><span><FileUp size={15}/> Dataset CSV</span><span>Buka ETL <ArrowRight size={13}/></span></div></button><button className={`workspace-card ${etlDone?'':'locked'}`} aria-disabled={!etlDone} onClick={openDashboard}><div className="workspace-icon teal-icon"><LayoutDashboard size={21}/></div><div className="workspace-card-top"><span className="eyebrow">ANALITIK &amp; PELAPORAN</span><ArrowRight size={17}/></div><h3>DASHBOARD</h3><p>Jelajahi enam halaman analitik untuk mengungkap tren dan peluang pendapatan.</p><div className="card-bottom"><span>{etlDone?<><BarChart3 size={15}/> 6 tampilan wawasan</>:<><Lock size={15}/> Terkunci · unggah dataset dahulu</>}</span><span>{etlDone?'Jelajahi DASHBOARD':'Buka ETL dahulu'} <ArrowRight size={13}/></span></div></button></section>{lockedNotice&&!etlDone&&<div className="locked-notice" role="alert"><Lock size={16}/><span>DASHBOARD belum dapat dibuka. Unggah dataset CSV atau gunakan demo dataset melalui <b>ETL</b> terlebih dahulu.</span><button onClick={()=>setScreen('ETL_PAGE')}>Buka ETL <ArrowRight size={13}/></button></div>}{etlDone?<section className="menu-insights"><span className="insight-icon"><Gauge size={17}/></span><div><strong>Indikator operasional utama</strong><p><b>{fmtPct((summary?.agg.completed ?? 0)/(summary?.agg.total || 1),0)}</b> tingkat penyelesaian <i/> <b>{fmtPct((summary?.agg.byStatus[1] ?? 0)/(summary?.agg.total || 1),0)}</b> tingkat pembatalan pengemudi <i/> <b>{fmtRp((summary?.agg.leak ?? 0))}</b> estimasi kebocoran pendapatan</p></div><button onClick={openDashboard}>Lihat ringkasan eksekutif <ArrowRight size={14}/></button></section>:<section className="menu-insights"><span className="insight-icon"><Lock size={17}/></span><div><strong>Belum ada data</strong><p>Indikator operasional akan tampil setelah dataset diunggah melalui ETL.</p></div><button onClick={()=>setScreen('ETL_PAGE')}>Buka ETL <ArrowRight size={14}/></button></section>}<footer className="menu-footer"><span>SISTEM DIAGNOSTIK OPERASIONAL &amp; PENDAPATAN UBER NCR</span><span>HANYA UNTUK PENGGUNAAN INTERNAL <i/> OPERASIONAL NCR</span></footer></main>
 if (view === 'ETL_PAGE') return <main className="etl-screen"><header className="menu-header"><Brand/><Button variant="secondary" onClick={()=>setScreen('MAIN_MENU')}><ArrowLeft size={15}/> Kembali ke Menu Utama</Button></header><EtlWorkspace onChanged={async()=>{ if(!await loadSession()) throw new Error('Sesi admin telah berakhir. Silakan masuk kembali.') }} onOpenDashboard={()=>setScreen('DASHBOARD')}/><footer className="etl-footer">SISTEM DIAGNOSTIK OPERASIONAL &amp; PENDAPATAN UBER NCR <span>HANYA UNTUK PENGGUNAAN INTERNAL</span></footer></main>
 return <Dashboard onBack={()=>setScreen('MAIN_MENU')} onLogout={handleLogout}/>
}
