import { getDatabase } from './database'
import {
  DEFAULT_FILTERS, MONTHS, STATUSES, STATUS_COLORS, type Agg, type Filters, type Range, type Row, type Status,
} from './data'

const DAY_MS = 86400000
const STATUS_SQL = `CASE lower(trim(booking_status))
  WHEN 'completed' THEN 'Selesai'
  WHEN 'cancelled by driver' THEN 'Dibatalkan pengemudi'
  WHEN 'cancelled by customer' THEN 'Dibatalkan pelanggan'
  WHEN 'no driver found' THEN 'Pengemudi tidak ditemukan'
  WHEN 'incomplete' THEN 'Perjalanan tidak selesai'
  ELSE trim(booking_status) END`
const VEHICLE_SQL = "COALESCE(NULLIF(trim(vehicle_type), ''), 'Tidak diketahui')"
const PAYMENT_SQL = "CASE WHEN payment_method IS NULL OR lower(trim(payment_method)) = 'null' OR trim(payment_method) = '' THEN 'Tidak dicatat' ELSE trim(payment_method) END"
const STATUS_TONE: Record<string, string> = {
  'Selesai': 'completed',
  'Dibatalkan pengemudi': 'driver-cancelled',
  'Dibatalkan pelanggan': 'cancelled',
  'Pengemudi tidak ditemukan': 'no-driver',
  'Perjalanan tidak selesai': 'driver-cancelled',
}
const ROW_LIMIT = 6
const DRILL_PAGE_SIZE = 12
const DRILL_DIMENSIONS = ['tanggal', 'kendaraan', 'status', 'pembayaran'] as const
type DrillDimension = (typeof DRILL_DIMENSIONS)[number]

type DatabaseRow = Record<string, string | number | null>
const groupedCache = new Map<string, DatabaseRow[]>()
const repeatCache = new Map<string, number>()

function isRange(value: string | null): value is Range {
  return value === '30 hari terakhir' || value === '7 hari terakhir' || value === 'Tahun berjalan'
}

function asDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function dateOffset(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return asDate(value)
}

function conditions(filters: Filters, start: string, end: string) {
  const clauses = ['booking_date BETWEEN ? AND ?']
  const values: (string | number)[] = [start, end]
  if (filters.status !== 'all') {
    clauses.push(`${STATUS_SQL} = ?`)
    values.push(filters.status)
  }
  if (filters.vehicle !== 'all') {
    clauses.push(`${VEHICLE_SQL} = ?`)
    values.push(filters.vehicle)
  }
  if (filters.payment !== 'all') {
    clauses.push(`${PAYMENT_SQL} = ?`)
    values.push(filters.payment)
  }
  return { where: clauses.join(' AND '), values }
}

function blankAgg(vehicles: string[], payments: string[]): Agg {
  return {
    total: 0,
    completed: 0,
    byStatus: STATUSES.map(() => 0),
    byVehicle: Object.fromEntries(vehicles.map(vehicle => [vehicle, STATUSES.map(() => 0)])),
    payRev: payments.map(() => 0),
    revenue: 0,
    lost: STATUSES.map(() => 0),
    leak: 0,
    rating: 0,
    repeat: 0,
    avgFare: 0,
  }
}

function groupedRows(start: string, end: string, version: number) {
  const db = getDatabase()
  const key = `${version}:${start}:${end}`
  const cached = groupedCache.get(key)
  if (cached) return cached
  const grouped = db.prepare(`
    SELECT ${STATUS_SQL} AS status, ${VEHICLE_SQL} AS vehicle, ${PAYMENT_SQL} AS payment,
      COUNT(*) AS total,
      SUM(CASE WHEN ${STATUS_SQL} = 'Selesai' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN ${STATUS_SQL} = 'Selesai' THEN COALESCE(booking_value, 0) ELSE 0 END) AS revenue,
      SUM(CASE WHEN ${STATUS_SQL} != 'Selesai' THEN COALESCE(booking_value, 0) ELSE 0 END) AS lost,
      SUM(CASE WHEN ${STATUS_SQL} != 'Selesai' AND booking_value > 0 THEN 1 ELSE 0 END) AS valued_lost_count,
      SUM(CASE WHEN ${STATUS_SQL} = 'Selesai' THEN COALESCE(driver_rating, 0) ELSE 0 END) AS rating_sum,
      SUM(CASE WHEN ${STATUS_SQL} = 'Selesai' AND driver_rating IS NOT NULL THEN 1 ELSE 0 END) AS rating_count
    FROM rides WHERE booking_date BETWEEN ? AND ?
    GROUP BY status, vehicle, payment
  `).all(start, end) as DatabaseRow[]
  if (groupedCache.size >= 8) groupedCache.clear()
  groupedCache.set(key, grouped)
  return grouped
}

function aggregate(grouped: DatabaseRow[], filters: Filters, vehicles: string[], payments: string[], fallbackFare = 0): Agg {
  const agg = blankAgg(vehicles, payments)
  let ratingSum = 0
  let ratingCount = 0
  const missingFareCount = STATUSES.map(() => 0)

  for (const row of grouped) {
    const status = String(row.status)
    const vehicle = String(row.vehicle)
    const payment = String(row.payment)
    if (filters.status !== 'all' && filters.status !== status) continue
    if (filters.vehicle !== 'all' && filters.vehicle !== vehicle) continue
    if (filters.payment !== 'all' && filters.payment !== payment) continue
    const statusIndex = STATUSES.indexOf(status as typeof STATUSES[number])
    const total = Number(row.total ?? 0)
    const completed = Number(row.completed ?? 0)
    const revenue = Number(row.revenue ?? 0)
    const lost = Number(row.lost ?? 0)
    if (statusIndex >= 0) {
      agg.byStatus[statusIndex] += total
      agg.lost[statusIndex] += lost
      missingFareCount[statusIndex] += Math.max(0, total - Number(row.valued_lost_count ?? 0))
    }
    if (!agg.byVehicle[vehicle]) agg.byVehicle[vehicle] = STATUSES.map(() => 0)
    if (statusIndex >= 0) agg.byVehicle[vehicle][statusIndex] += total
    const paymentIndex = payments.indexOf(payment)
    if (paymentIndex >= 0) agg.payRev[paymentIndex] += revenue
    agg.total += total
    agg.completed += completed
    agg.revenue += revenue
    ratingSum += Number(row.rating_sum ?? 0)
    ratingCount += Number(row.rating_count ?? 0)
  }

  const avgFare = agg.completed ? agg.revenue / agg.completed : fallbackFare
  for (let i = 1; i < agg.lost.length; i++) agg.lost[i] += missingFareCount[i] * avgFare
  agg.leak = agg.lost.reduce((sum, value, index) => index === 0 ? sum : sum + value, 0)
  agg.rating = ratingCount ? ratingSum / ratingCount : 0
  agg.avgFare = avgFare
  return agg
}

function repeatBookingShare(filters: Filters, start: string, end: string, total: number, version: number) {
  if (!total) return 0
  const key = `${version}:${start}:${end}:${filters.status}:${filters.vehicle}:${filters.payment}`
  const cached = repeatCache.get(key)
  if (cached !== undefined) return cached
  const { where, values } = conditions(filters, start, end)
  const repeat = getDatabase().prepare(`
    SELECT COALESCE(SUM(customer_bookings), 0) AS repeat_bookings FROM (
      SELECT COUNT(*) AS customer_bookings FROM rides
      WHERE ${where} AND customer_id IS NOT NULL
      GROUP BY customer_id HAVING COUNT(*) > 1
    )
  `).get(...values) as DatabaseRow | undefined
  const share = Number(repeat?.repeat_bookings ?? 0) / total
  if (repeatCache.size >= 100) repeatCache.clear()
  repeatCache.set(key, share)
  return share
}

function getSeries(filters: Filters, range: Range, latestDate: string, start: string, end: string, metric: 'bookings' | 'revenue') {
  const { where, values } = conditions(filters, start, end)
  const rows = getDatabase().prepare(`
    SELECT booking_date AS date, COUNT(*) AS bookings,
      SUM(CASE WHEN ${STATUS_SQL} = 'Selesai' THEN COALESCE(booking_value, 0) ELSE 0 END) AS revenue
    FROM rides WHERE ${where} GROUP BY booking_date ORDER BY booking_date
  `).all(...values) as DatabaseRow[]
  const data = new Map(rows.map(row => [String(row.date), Number(metric === 'bookings' ? row.bookings : row.revenue ?? 0)]))

  if (range === 'Tahun berjalan') {
    const year = latestDate.slice(0, 4)
    const labels = MONTHS
    const valuesByPeriod = labels.map((_, month) => {
      const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
      return [...data].reduce((sum, [date, value]) => date.startsWith(monthPrefix) ? sum + value : sum, 0)
    })
    return {
      labels, tips: labels.map(month => `${month} ${year}`), values: valuesByPeriod,
      subtitle: `Tren bulanan · Jan – Des ${year}`,
    }
  }

  const count = range === '7 hari terakhir' ? 7 : 30
  const labels: string[] = []
  const tips: string[] = []
  const valuesByPeriod: number[] = []
  const date = new Date(`${end}T00:00:00.000Z`)
  for (let offset = count - 1; offset >= 0; offset--) {
    const current = new Date(date.getTime() - offset * DAY_MS)
    const key = asDate(current)
    labels.push(range === '30 hari terakhir' && offset > 0 && offset % 5 !== 0 ? '' : String(current.getUTCDate()))
    tips.push(`${current.getUTCDate()} ${MONTHS[current.getUTCMonth()]} ${current.getUTCFullYear()}`)
    valuesByPeriod.push(data.get(key) ?? 0)
  }
  return { labels, tips, values: valuesByPeriod, subtitle: `Tren harian · ${range.toLowerCase()}` }
}

function formatRow(row: DatabaseRow): Row {
  const id = String(row.booking_id ?? '').replace(/^"+|"+$/g, '')
  const date = String(row.booking_date ?? '')
  const time = String(row.booking_time ?? '00:00:00')
  const parsedDate = new Date(`${date}T${time}Z`)
  const status = String(row.booking_status ?? 'Tidak diketahui')
  const normalizedStatus = ({
    Completed: 'Selesai',
    'Cancelled by Driver': 'Dibatalkan pengemudi',
    'Cancelled by Customer': 'Dibatalkan pelanggan',
    'No Driver Found': 'Pengemudi tidak ditemukan',
    Incomplete: 'Perjalanan tidak selesai',
  } as Record<string, string>)[status] ?? status
  return {
    key: Number(row.ride_id),
    id,
    ts: parsedDate.getTime(),
    date: `${parsedDate.getUTCDate()} ${MONTHS[parsedDate.getUTCMonth()]} ${parsedDate.getUTCFullYear()}, ${String(parsedDate.getUTCHours()).padStart(2, '0')}:${String(parsedDate.getUTCMinutes()).padStart(2, '0')}`,
    vehicle: String(row.vehicle_type ?? 'Tidak diketahui'),
    pickup: String(row.pickup_location ?? '—'),
    dropoff: String(row.drop_location ?? '—'),
    status: normalizedStatus,
    tone: STATUS_TONE[normalizedStatus] ?? 'no-driver',
    payment: row.payment_method == null ? 'Tidak dicatat' : String(row.payment_method),
    fare: Number(row.booking_value ?? 0),
  }
}

export function getDashboardData(params: URLSearchParams) {
  const db = getDatabase()
  const latestDate = String(db.prepare("SELECT value FROM metadata WHERE key = 'latest_date'").get()?.value ?? '')
  const totalRows = Number(db.prepare('SELECT COUNT(*) AS count FROM rides').get()?.count ?? 0)
  const datasetVersion = Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS version FROM dataset_imports').get()?.version ?? 0)
  const vehicleOptions = (db.prepare(`SELECT DISTINCT ${VEHICLE_SQL} AS value FROM rides ORDER BY value`).all() as DatabaseRow[])
    .map(row => String(row.value))
  const paymentOptions = (db.prepare(`SELECT DISTINCT ${PAYMENT_SQL} AS value FROM rides ORDER BY value`).all() as DatabaseRow[])
    .map(row => String(row.value))
  const rangeValue = params.get('range')
  const range: Range = isRange(rangeValue) ? rangeValue : DEFAULT_FILTERS.range
  const filters: Filters = {
    range,
    vehicle: vehicleOptions.includes(params.get('vehicle') ?? '') ? params.get('vehicle')! : 'all',
    status: STATUSES.includes(params.get('status') as typeof STATUSES[number]) ? params.get('status') as Filters['status'] : 'all',
    payment: paymentOptions.includes(params.get('payment') ?? '') ? params.get('payment')! : 'all',
  }

  if (!latestDate) {
    const empty = blankAgg(vehicleOptions, paymentOptions)
    return {
      agg: empty, prev: null, aggAllStatus: empty, aggAllVehicle: empty, aggAllPayment: empty,
      bookingSeries: { labels: [], tips: [], values: [], subtitle: 'Belum ada data' },
      revenueSeries: { labels: [], tips: [], values: [], subtitle: 'Belum ada data' },
      latestDate: '', reasons: [], rows: [], rowCount: 0, totalRows, options: { vehicles: vehicleOptions, payments: paymentOptions },
      extras: { peakHour: null, topPickup: null },
    }
  }

  const days = range === '7 hari terakhir' ? 7 : 30
  const start = range === 'Tahun berjalan' ? `${latestDate.slice(0, 4)}-01-01` : dateOffset(latestDate, -(days - 1))
  const end = latestDate
  const previousEnd = dateOffset(start, -1)
  const previousStart = range === 'Tahun berjalan'
    ? `${Number(latestDate.slice(0, 4)) - 1}-01-01`
    : dateOffset(previousEnd, -(days - 1))
  const previousFilters = range === 'Tahun berjalan'
    ? null
    : { start: previousStart, end: previousEnd }
  const filtersWithoutRange = filters
  const currentGroups = groupedRows(start, end, datasetVersion)
  const previousGroups = previousFilters ? groupedRows(previousFilters.start, previousFilters.end, datasetVersion) : null
  const aggAllStatus = aggregate(currentGroups, { ...filtersWithoutRange, status: 'all' }, vehicleOptions, paymentOptions)
  const prevAllStatus = previousGroups && previousFilters
    ? aggregate(previousGroups, { ...filtersWithoutRange, status: 'all' }, vehicleOptions, paymentOptions)
    : null
  const agg = aggregate(currentGroups, filters, vehicleOptions, paymentOptions, aggAllStatus.avgFare)
  const prev = previousFilters && previousGroups
    ? aggregate(previousGroups, filters, vehicleOptions, paymentOptions, prevAllStatus?.avgFare)
    : null
  agg.repeat = repeatBookingShare(filters, start, end, agg.total, datasetVersion)
  if (prev && previousFilters) {
    prev.repeat = repeatBookingShare(filters, previousFilters.start, previousFilters.end, prev.total, datasetVersion)
  }
  const aggAllVehicle = aggregate(currentGroups, { ...filtersWithoutRange, vehicle: 'all' }, vehicleOptions, paymentOptions)
  const aggAllPayment = aggregate(currentGroups, { ...filtersWithoutRange, payment: 'all' }, vehicleOptions, paymentOptions)
  const bookingSeries = getSeries(filters, range, latestDate, start, end, 'bookings')
  const revenueSeries = getSeries(filters, range, latestDate, start, end, 'revenue')
  const { where, values } = conditions(filters, start, end)
  const reasonRows = db.prepare(`
    SELECT status, label, SUM(total) AS value FROM (
      SELECT 'Dibatalkan pengemudi' AS status, trim(cancel_driver_reason) AS label, COUNT(*) AS total
      FROM rides WHERE ${where} AND cancel_driver_reason IS NOT NULL AND lower(trim(cancel_driver_reason)) != 'null'
      GROUP BY trim(cancel_driver_reason)
      UNION ALL
      SELECT 'Dibatalkan pelanggan' AS status, trim(cancel_customer_reason) AS label, COUNT(*) AS total
      FROM rides WHERE ${where} AND cancel_customer_reason IS NOT NULL AND lower(trim(cancel_customer_reason)) != 'null'
      GROUP BY trim(cancel_customer_reason)
    ) GROUP BY status, label ORDER BY value DESC
  `).all(...values, ...values) as DatabaseRow[]
  const reasons = reasonRows.map(row => ({ label: String(row.label), value: Number(row.value), status: String(row.status) }))
  // Data tambahan untuk insight otomatis: jam tersibuk & titik jemput terbanyak pada filter aktif.
  const hourRows = db.prepare(`
    SELECT substr(booking_time, 1, 2) AS hour, COUNT(*) AS total FROM rides
    WHERE ${where} AND booking_time IS NOT NULL AND length(booking_time) >= 2
    GROUP BY hour ORDER BY total DESC, hour ASC
  `).all(...values) as DatabaseRow[]
  const timedTotal = hourRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0)
  const peakHour = hourRows.length && Number.isFinite(Number(hourRows[0].hour))
    ? { hour: Number(hourRows[0].hour), count: Number(hourRows[0].total), share: timedTotal ? Number(hourRows[0].total) / timedTotal : 0 }
    : null
  const pickupRow = db.prepare(`
    SELECT trim(pickup_location) AS label, COUNT(*) AS total FROM rides
    WHERE ${where} AND pickup_location IS NOT NULL AND trim(pickup_location) != '' AND lower(trim(pickup_location)) != 'null'
    GROUP BY label ORDER BY total DESC, label ASC LIMIT 1
  `).get(...values) as DatabaseRow | undefined
  const topPickup = pickupRow ? { label: String(pickupRow.label), count: Number(pickupRow.total) } : null
  const search = (params.get('search') ?? '').trim()
  const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1))
  const searchClause = search ? ' AND booking_id LIKE ?' : ''
  const countParams = search ? [...values, `%${search}%`] : values
  const rowCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM rides WHERE ${where}${searchClause}`).get(...countParams)?.count ?? 0)
  const sort = params.get('sort')
  const sortSql: Record<string, string> = {
    id: 'booking_id',
    ts: 'booking_date, booking_time',
    vehicle: VEHICLE_SQL,
    status: STATUS_SQL,
    payment: PAYMENT_SQL,
    fare: 'booking_value',
  }
  const order = sortSql[sort ?? 'ts'] ?? sortSql.ts
  const direction = params.get('direction') === 'asc' ? 'ASC' : 'DESC'
  const rows = db.prepare(`
    SELECT ride_id, booking_id, booking_date, booking_time, booking_status, vehicle_type,
      pickup_location, drop_location, payment_method, booking_value
    FROM rides WHERE ${where}${searchClause}
    ORDER BY ${order} ${direction}, ride_id DESC LIMIT ? OFFSET ?
  `).all(...countParams, ROW_LIMIT, (page - 1) * ROW_LIMIT) as DatabaseRow[]

  return {
    agg, prev, aggAllStatus, aggAllVehicle, aggAllPayment,
    bookingSeries, revenueSeries, latestDate, reasons, rows: rows.map(formatRow), rowCount, totalRows,
    options: { vehicles: vehicleOptions, payments: paymentOptions },
    extras: { peakHour, topPickup },
  }
}

export function getDrilldownData(params: URLSearchParams) {
  const db = getDatabase()
  const latestDate = String(db.prepare("SELECT value FROM metadata WHERE key = 'latest_date'").get()?.value ?? '')
  const rangeValue = params.get('range')
  const range: Range = isRange(rangeValue) ? rangeValue : DEFAULT_FILTERS.range
  const vehicleOptions = (db.prepare(`SELECT DISTINCT ${VEHICLE_SQL} AS value FROM rides ORDER BY value`).all() as DatabaseRow[])
    .map(row => String(row.value))
  const paymentOptions = (db.prepare(`SELECT DISTINCT ${PAYMENT_SQL} AS value FROM rides ORDER BY value`).all() as DatabaseRow[])
    .map(row => String(row.value))
  const filters: Filters = {
    range,
    vehicle: vehicleOptions.includes(params.get('vehicle') ?? '') ? params.get('vehicle')! : 'all',
    status: STATUSES.includes(params.get('status') as typeof STATUSES[number]) ? params.get('status') as Filters['status'] : 'all',
    payment: paymentOptions.includes(params.get('payment') ?? '') ? params.get('payment')! : 'all',
  }
  if (!latestDate) {
    return { level: 'tanggal' as DrillDimension, path: [], rows: [], rowCount: 0, page: 1, totalRows: 0, latestDate: '' }
  }

  const days = range === '7 hari terakhir' ? 7 : 30
  const start = range === 'Tahun berjalan' ? `${latestDate.slice(0, 4)}-01-01` : dateOffset(latestDate, -(days - 1))
  const { where: baseWhere, values } = conditions(filters, start, latestDate)
  const clauses = [baseWhere]
  const path: { dimension: DrillDimension; value: string }[] = []
  const pathParams = ['drillDate', 'drillVehicle', 'drillStatus', 'drillPayment'] as const
  const pathExpressions = [null, VEHICLE_SQL, STATUS_SQL, PAYMENT_SQL] as const

  for (let index = 0; index < pathParams.length; index++) {
    const value = params.get(pathParams[index])
    if (value === null || value === '') break

    if (index === 0) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < start || value > latestDate) {
        throw new Error('Tanggal pada jalur drill down tidak valid.')
      }
    } else if (index === 1 && !vehicleOptions.includes(value)) {
      throw new Error('Kendaraan pada jalur drill down tidak valid.')
    } else if (index === 2 && !STATUSES.includes(value as Status)) {
      throw new Error('Status pada jalur drill down tidak valid.')
    } else if (index === 3 && !paymentOptions.includes(value)) {
      throw new Error('Pembayaran pada jalur drill down tidak valid.')
    }

    const dimension = DRILL_DIMENSIONS[index]
    path.push({ dimension, value })
    const expression = pathExpressions[index] ?? 'booking_date'
    clauses.push(`${expression} = ?`)
    values.push(value)
  }

  const where = clauses.join(' AND ')
  const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1))
  const level = DRILL_DIMENSIONS[path.length]
  if (!level) {
    const rowCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM rides WHERE ${where}`).get(...values)?.count ?? 0)
    const records = db.prepare(`
      SELECT ride_id, booking_id, booking_date, booking_time, booking_status, vehicle_type,
        pickup_location, drop_location, payment_method, booking_value
      FROM rides WHERE ${where} ORDER BY booking_date DESC, booking_time DESC, ride_id DESC
      LIMIT ? OFFSET ?
    `).all(...values, DRILL_PAGE_SIZE, (page - 1) * DRILL_PAGE_SIZE) as DatabaseRow[]
    return {
      level: 'detail' as const, path, rows: records.map(formatRow), rowCount, page,
      totalRows: rowCount, latestDate,
    }
  }

  const expression = ({
    tanggal: 'booking_date',
    kendaraan: VEHICLE_SQL,
    status: STATUS_SQL,
    pembayaran: PAYMENT_SQL,
  } satisfies Record<DrillDimension, string>)[level]
  const rowCount = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM (SELECT ${expression} FROM rides WHERE ${where} GROUP BY ${expression})
  `).get(...values)?.count ?? 0)
  const groupRows = db.prepare(`
    SELECT ${expression} AS value, COUNT(*) AS total,
      SUM(CASE WHEN ${STATUS_SQL} = 'Selesai' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN ${STATUS_SQL} = 'Selesai' THEN COALESCE(booking_value, 0) ELSE 0 END) AS revenue,
      SUM(CASE WHEN ${STATUS_SQL} != 'Selesai' THEN 1 ELSE 0 END) AS cancelled
    FROM rides WHERE ${where}
    GROUP BY ${expression}
    ORDER BY ${level === 'tanggal' ? 'value' : 'total'} DESC, value ASC
    LIMIT ? OFFSET ?
  `).all(...values, DRILL_PAGE_SIZE, (page - 1) * DRILL_PAGE_SIZE) as DatabaseRow[]

  return {
    level,
    path,
    rows: groupRows.map(row => ({
      value: String(row.value ?? 'Tidak dicatat'),
      total: Number(row.total ?? 0),
      completed: Number(row.completed ?? 0),
      revenue: Number(row.revenue ?? 0),
      cancelled: Number(row.cancelled ?? 0),
    })),
    rowCount,
    page,
    totalRows: Number(db.prepare(`SELECT COUNT(*) AS count FROM rides WHERE ${where}`).get(...values)?.count ?? 0),
    latestDate,
  }
}

export { STATUS_COLORS }
