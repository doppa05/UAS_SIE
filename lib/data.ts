export const STATUSES = [
  'Selesai',
  'Dibatalkan pengemudi',
  'Dibatalkan pelanggan',
  'Pengemudi tidak ditemukan',
  'Perjalanan tidak selesai',
] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_COLORS = ['#2563eb', '#f59e0b', '#0f9f8f', '#cbd5e1', '#8b5cf6']
export const STATUS_TONES = ['completed', 'driver-cancelled', 'cancelled', 'no-driver', 'incomplete']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const RANGES = ['30 hari terakhir', '7 hari terakhir', 'Tahun berjalan'] as const

export type Vehicle = string
export type Payment = string
export type Range = (typeof RANGES)[number]
export type Filters = { range: Range; vehicle: Vehicle | 'all'; status: Status | 'all'; payment: Payment | 'all' }
export const DEFAULT_FILTERS: Filters = { range: '30 hari terakhir', vehicle: 'all', status: 'all', payment: 'all' }

export type Agg = {
  total: number
  completed: number
  byStatus: number[]
  byVehicle: Record<string, number[]>
  payRev: number[]
  revenue: number
  lost: number[]
  leak: number
  rating: number
  repeat: number
  avgFare: number
}

export type Row = {
  key: number
  id: string
  ts: number
  date: string
  vehicle: Vehicle
  pickup: string
  dropoff: string
  status: Status | string
  tone: string
  payment: Payment
  fare: number
}

const trim = (n: number, d = 1) => String(+n.toFixed(d)).replace('.', ',')
export const fmtInt = (n: number) => Math.round(n).toLocaleString('id-ID')
export const fmtPct = (x: number, d = 1) => `${(x * 100).toFixed(d).replace('.', ',')}%`
export const fmtCompact = (n: number) => (n >= 1e6 ? `${trim(n / 1e6, 2)} jt` : n >= 1e3 ? `${trim(n / 1e3)} rb` : String(Math.round(n)))
export const fmtRp = (n: number) =>
  n >= 1e9 ? `Rp ${(n / 1e9).toFixed(2).replace('.', ',')} miliar` : n >= 1e6 ? `Rp ${(n / 1e6).toFixed(2).replace('.', ',')} jt` : n >= 1e3 ? `Rp ${trim(n / 1e3)} rb` : `Rp ${Math.round(n)}`
export const fmtRpCompact = (n: number) => (n >= 1e9 ? `${trim(n / 1e9, 2)} mlr` : n >= 1e6 ? `${trim(n / 1e6)} jt` : n >= 1e3 ? `${trim(n / 1e3)} rb` : String(Math.round(n)))

export function niceMax(v: number) {
  if (v <= 0) return 1
  const raw = v / 4
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  const step = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(c => f <= c + 1e-9) ?? 10) * p
  return step * 4
}

export type Trend = { text: string; dir: 'up' | 'down' | 'flat'; good: boolean }
export function trend(cur: number, prev: number | null | undefined, opt: { rate?: boolean; lowerIsBetter?: boolean } = {}): Trend | null {
  if (prev == null || !isFinite(prev) || (!opt.rate && prev === 0)) return null
  const diff = opt.rate ? (cur - prev) * 100 : ((cur - prev) / prev) * 100
  const abs = Math.abs(diff)
  const dir = abs < 0.05 ? 'flat' : diff > 0 ? 'up' : 'down'
  const text = `${diff > 0.05 ? '+' : diff < -0.05 ? '−' : ''}${abs.toFixed(1).replace('.', ',')}${opt.rate ? ' poin' : '%'}`
  return { text, dir, good: dir === 'flat' ? true : opt.lowerIsBetter ? diff < 0 : diff > 0 }
}
