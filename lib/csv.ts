import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

const columns = [
  'booking_id', 'booking_date', 'booking_time', 'booking_status', 'customer_id',
  'vehicle_type', 'pickup_location', 'drop_location', 'avg_vtat', 'avg_ctat',
  'cancelled_by_customer', 'cancel_customer_reason', 'cancelled_by_driver',
  'cancel_driver_reason', 'incomplete_rides', 'incomplete_reason', 'booking_value',
  'ride_distance', 'driver_rating', 'customer_rating', 'payment_method',
] as const

const csvHeaders = [
  'Date', 'Time', 'Booking ID', 'Booking Status', 'Customer ID', 'Vehicle Type',
  'Pickup Location', 'Drop Location', 'Avg VTAT', 'Avg CTAT',
  'Cancelled Rides by Customer', 'Reason for cancelling by Customer',
  'Cancelled Rides by Driver', 'Driver Cancellation Reason', 'Incomplete Rides',
  'Incomplete Rides Reason', 'Booking Value', 'Ride Distance', 'Driver Ratings',
  'Customer Rating', 'Payment Method',
]
const databaseHeaders = [
  'Booking ID', 'Date', 'Time', 'Booking Status', 'Customer ID', 'Vehicle Type',
  'Pickup Location', 'Drop Location', 'Avg VTAT', 'Avg CTAT',
  'Cancelled Rides by Customer', 'Reason for cancelling by Customer',
  'Cancelled Rides by Driver', 'Driver Cancellation Reason', 'Incomplete Rides',
  'Incomplete Rides Reason', 'Booking Value', 'Ride Distance', 'Driver Ratings',
  'Customer Rating', 'Payment Method',
]

const statementSql = `INSERT INTO rides (${columns.join(', ')})
  VALUES (${columns.map(() => '?').join(', ')})`

function parseRecords(text: string, onRecord: (record: string[]) => void) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let record: string[] = []
  let field = ''
  let quoted = false
  let atFieldStart = true

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"' && atFieldStart) {
      quoted = true
      atFieldStart = false
    } else if (char === ',') {
      record.push(field)
      field = ''
      atFieldStart = true
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      record.push(field)
      if (record.some(value => value.length > 0)) onRecord(record)
      record = []
      field = ''
      atFieldStart = true
    } else {
      field += char
      atFieldStart = false
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field)
    if (record.some(value => value.length > 0)) onRecord(record)
  }
  if (quoted) throw new Error('CSV memiliki tanda kutip yang tidak berpasangan.')
}

function nullable(value: string) {
  const cleaned = value.trim()
  return cleaned === '' || cleaned.toLowerCase() === 'null' ? null : cleaned
}

function bookingId(value: string) {
  return value.trim().replace(/^"+|"+$/g, '')
}


const numericHeaders = [
  'Avg VTAT', 'Avg CTAT', 'Cancelled Rides by Customer', 'Cancelled Rides by Driver',
  'Incomplete Rides', 'Booking Value', 'Ride Distance', 'Driver Ratings', 'Customer Rating',
]

function headerError(record: string[]) {
  const headers = record.map(value => value.trim())
  if (headers.length !== csvHeaders.length || csvHeaders.some((header, index) => headers[index] !== header)) {
    return 'Header atau urutan kolom CSV tidak sesuai format pemesanan yang didukung.'
  }
  return null
}

// Validasi satu baris data. Dipakai bersama oleh analisis (langkah 1) dan impor agar aturannya selalu sama.
function parseBookingRecord(record: string[], rowNumber: number) {
  if (record.length !== columns.length) {
    throw new Error(`Jumlah kolom pada baris ${rowNumber} tidak sesuai header CSV.`)
  }
  const values = record.map(nullable)
  const id = bookingId(record[headersIndex('Booking ID')])
  const date = values[headersIndex('Date')]
  const status = values[headersIndex('Booking Status')]
  const timestamp = date ? Date.parse(`${date}T00:00:00.000Z`) : NaN
  if (!id || !date || !status || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new Error(`ID, tanggal, atau status pemesanan tidak valid pada baris ${rowNumber}.`)
  }
  for (const header of numericHeaders) {
    const value = values[headersIndex(header)]
    if (value !== null && !Number.isFinite(Number(value))) {
      throw new Error(`Nilai ${header} tidak valid pada baris ${rowNumber}.`)
    }
  }
  values[headersIndex('Booking ID')] = id
  return { id, date, status, values }
}

export type ImportMode = 'replace' | 'append'

export function importCsv(db: DatabaseSync, text: string, source: string, mode: ImportMode = 'replace') {
  let headerSeen = false
  let rowNumber = 0
  let imported = 0
  let skipped = 0
  const insert = db.prepare(statementSql)
  const recordImport = db.prepare(
    'INSERT INTO dataset_imports (source, row_count, checksum) VALUES (?, ?, ?)',
  )

  db.exec('BEGIN IMMEDIATE')
  try {
    // Abaikan Booking ID yang sudah tersimpan atau berulang di berkas yang sama.
    const knownIds = new Set(
      mode === 'append'
        ? (db.prepare('SELECT booking_id FROM rides').all() as { booking_id: string }[]).map(r => r.booking_id)
        : [],
    )
    parseRecords(text, record => {
      rowNumber++
      if (!headerSeen) {
        const problem = headerError(record)
        if (problem) throw new Error(problem)
        headerSeen = true
        if (mode === 'replace') db.exec('DELETE FROM rides')
        return
      }

      const { id, values } = parseBookingRecord(record, rowNumber)

      if (knownIds.has(id)) { skipped++; return }
      knownIds.add(id)
      const ordered = databaseHeaders.map(header => values[headersIndex(header)])
      insert.run(...ordered)
      imported++
    })

    if (!headerSeen) throw new Error('CSV tidak memiliki baris pemesanan untuk diimpor.')
    if (imported === 0) {
      throw new Error(skipped > 0
        ? `Semua ${skipped.toLocaleString('id-ID')} baris sudah ada di database (Booking ID sama). Tidak ada data baru yang ditambahkan.`
        : 'CSV tidak memiliki baris pemesanan untuk diimpor.')
    }
    recordImport.run(mode === 'append' ? `${source} (tambah)` : source, imported, createHash('sha256').update(text).digest('hex'))
    const { totalRows, latestDate } = refreshMetadata(db)
    db.exec('COMMIT')
    return { mode, rowCount: imported, skipped, totalRows, latestDate }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export type AnalysisSample = {
  booking_id: string; booking_date: string; booking_time: string | null; booking_status: string
  customer_id: string | null; vehicle_type: string | null; pickup_location: string | null
  drop_location: string | null; payment_method: string | null; booking_value: string | null
  ride_distance: string | null; avg_vtat: string | null; avg_ctat: string | null
  driver_rating: string | null; customer_rating: string | null; reason: string | null
  in_database: boolean
}

const MAX_REPORTED_ERRORS = 8
const MAX_SAMPLES = 12

// Langkah 1 ETL: membaca & memeriksa CSV tanpa mengubah database sedikit pun.
// Hasilnya dipakai untuk menentukan lanjut ke Timpa, Tambah (import), atau Input Manual.
export function analyzeCsv(db: DatabaseSync, text: string) {
  const existing = new Set((db.prepare('SELECT booking_id FROM rides').all() as { booking_id: string }[]).map(r => r.booking_id))
  const seenInFile = new Set<string>()
  const statusCounts: Record<string, number> = {}
  const errors: { row: number; message: string }[] = []
  const samples: AnalysisSample[] = []
  let headerProblem: string | null = null
  let headerSeen = false
  let rowNumber = 0
  let dataRows = 0
  let validRows = 0
  let invalidRows = 0
  let duplicateInFile = 0
  let alreadyInDatabase = 0
  let minDate: string | null = null
  let maxDate: string | null = null

  const idx = (header: string) => headersIndex(header)
  try {
    parseRecords(text, record => {
      rowNumber++
      if (!headerSeen) {
        headerSeen = true
        headerProblem = headerError(record)
        return
      }
      if (headerProblem) return
      dataRows++
      try {
        const { id, date, status, values } = parseBookingRecord(record, rowNumber)
        validRows++
        statusCounts[status] = (statusCounts[status] ?? 0) + 1
        if (minDate === null || date < minDate) minDate = date
        if (maxDate === null || date > maxDate) maxDate = date
        if (seenInFile.has(id)) duplicateInFile++
        else {
          seenInFile.add(id)
          if (existing.has(id)) alreadyInDatabase++
        }
        if (samples.length < MAX_SAMPLES) {
          const get = (header: string) => values[idx(header)] ?? null
          samples.push({
            booking_id: id, booking_date: date, booking_time: get('Time'), booking_status: status,
            customer_id: get('Customer ID')?.replace(/^"+|"+$/g, '') ?? null, vehicle_type: get('Vehicle Type'),
            pickup_location: get('Pickup Location'), drop_location: get('Drop Location'),
            payment_method: get('Payment Method'), booking_value: get('Booking Value'),
            ride_distance: get('Ride Distance'), avg_vtat: get('Avg VTAT'), avg_ctat: get('Avg CTAT'),
            driver_rating: get('Driver Ratings'), customer_rating: get('Customer Rating'),
            reason: get('Reason for cancelling by Customer') ?? get('Driver Cancellation Reason') ?? get('Incomplete Rides Reason'),
            in_database: existing.has(id),
          })
        }
      } catch (error) {
        invalidRows++
        if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row: rowNumber, message: error instanceof Error ? error.message : 'Baris tidak valid.' })
      }
    })
  } catch (error) {
    headerProblem = error instanceof Error ? error.message : 'CSV tidak dapat dibaca.'
  }

  if (!headerSeen) headerProblem = 'CSV kosong atau tidak memiliki header.'
  const uniqueInFile = seenInFile.size
  const newRows = uniqueInFile - alreadyInDatabase
  return {
    headerOk: !headerProblem,
    headerError: headerProblem,
    dataRows, validRows, invalidRows, duplicateInFile, alreadyInDatabase, uniqueInFile,
    // Perkiraan hasil tiap metode, supaya pengguna tahu dampaknya sebelum memilih.
    newRows,
    canReplace: !headerProblem && invalidRows === 0 && validRows > 0,
    canAppend: !headerProblem && invalidRows === 0 && newRows > 0,
    dateFrom: minDate, dateTo: maxDate,
    statusCounts, errors, samples,
  }
}

function headersIndex(header: string) {
  return csvHeaders.indexOf(header)
}

// Menyegarkan jumlah baris & tanggal terbaru. Dipanggil setiap data berubah.
export function refreshMetadata(db: DatabaseSync) {
  const stats = db.prepare('SELECT COUNT(*) AS total, MAX(booking_date) AS latest FROM rides').get() as
    { total: number; latest: string | null }
  const totalRows = Number(stats.total)
  const latestDate = stats.latest ?? ''
  db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('row_count', ?)").run(String(totalRows))
  db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('latest_date', ?)").run(latestDate)
  return { totalRows, latestDate }
}

export function clearDataset(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const deletedRows = Number(db.prepare('SELECT COUNT(*) AS total FROM rides').get()?.total ?? 0)
    db.exec('DELETE FROM rides; DELETE FROM dataset_imports; DELETE FROM metadata;')
    const { totalRows, latestDate } = refreshMetadata(db)
    db.exec('COMMIT')
    return { deletedRows, totalRows, latestDate }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function deleteSelectedRides(db: DatabaseSync, rideIds: number[]) {
  if (rideIds.length === 0 || rideIds.length > 1000 ||
      rideIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Daftar pemesanan yang dipilih tidak valid.')
  }

  const ids = [...new Set(rideIds)]
  db.exec('BEGIN IMMEDIATE')
  try {
    const placeholders = ids.map(() => '?').join(', ')
    const deletedRows = Number(db.prepare(`DELETE FROM rides WHERE ride_id IN (${placeholders})`).run(...ids).changes)
    const { totalRows, latestDate } = refreshMetadata(db)
    db.exec('COMMIT')
    return { deletedRows, totalRows, latestDate }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export const BOOKING_STATUSES = [
  'Completed', 'Cancelled by Driver', 'Cancelled by Customer', 'No Driver Found', 'Incomplete',
] as const

export type ManualRideInput = Partial<Record<
  | 'booking_id' | 'booking_date' | 'booking_time' | 'booking_status' | 'customer_id' | 'vehicle_type'
  | 'pickup_location' | 'drop_location' | 'payment_method' | 'booking_value' | 'ride_distance'
  | 'avg_vtat' | 'avg_ctat' | 'driver_rating' | 'customer_rating' | 'reason', unknown>>

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function number(value: unknown, label: string, min: number, max: number) {
  const raw = text(value)
  if (raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} harus berupa angka antara ${min} dan ${max}.`)
  return n
}

// Input manual (satu baris pemesanan) lewat form. Validasi mengikuti aturan yang sama dengan impor CSV.
export function insertManualRide(db: DatabaseSync, input: ManualRideInput) {
  const id = bookingId(text(input.booking_id))
  const date = text(input.booking_date)
  const time = text(input.booking_time)
  const status = text(input.booking_status)
  const reason = text(input.reason)

  if (!id) throw new Error('Booking ID wajib diisi.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Tanggal tidak valid. Gunakan format YYYY-MM-DD.')
  }
  if (time && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) throw new Error('Waktu tidak valid. Gunakan format HH:MM atau HH:MM:SS.')
  if (!(BOOKING_STATUSES as readonly string[]).includes(status)) throw new Error('Status pemesanan tidak valid.')

  const vehicle = text(input.vehicle_type)
  if (!vehicle) throw new Error('Jenis kendaraan wajib diisi.')
  if (!text(input.customer_id)) throw new Error('Customer ID wajib diisi.')

  const bookingValue = number(input.booking_value, 'Nilai pemesanan', 0, 1e7)
  const distance = number(input.ride_distance, 'Jarak perjalanan', 0, 5000)
  const vtat = number(input.avg_vtat, 'Avg VTAT', 0, 1000)
  const ctat = number(input.avg_ctat, 'Avg CTAT', 0, 1000)
  const driverRating = number(input.driver_rating, 'Rating pengemudi', 0, 5)
  const customerRating = number(input.customer_rating, 'Rating pelanggan', 0, 5)
  const payment = text(input.payment_method)

  if (status === 'Completed') {
    if (bookingValue === null) throw new Error('Nilai pemesanan wajib diisi untuk pemesanan yang selesai.')
    if (!payment) throw new Error('Metode pembayaran wajib diisi untuk pemesanan yang selesai.')
  } else if (status !== 'No Driver Found' && !reason) {
    throw new Error('Alasan pembatalan / ketidaklengkapan wajib diisi untuk status ini.')
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    if (db.prepare('SELECT 1 FROM rides WHERE booking_id = ? LIMIT 1').get(id)) {
      throw new Error(`Booking ID ${id} sudah ada di database.`)
    }
    const byCustomer = status === 'Cancelled by Customer'
    const byDriver = status === 'Cancelled by Driver'
    const incomplete = status === 'Incomplete'
    // Urutan nilai sama dengan `columns` di atas.
    const row = [
      id, date, time || null, status, text(input.customer_id), vehicle,
      text(input.pickup_location) || null, text(input.drop_location) || null, vtat, ctat,
      byCustomer ? 1 : null, byCustomer ? reason : null,
      byDriver ? 1 : null, byDriver ? reason : null,
      incomplete ? 1 : null, incomplete ? reason : null,
      bookingValue, distance, driverRating, customerRating, payment || null,
    ]
    db.prepare(statementSql).run(...row)
    db.prepare('INSERT INTO dataset_imports (source, row_count, checksum) VALUES (?, ?, ?)')
      .run('input-manual', 1, createHash('sha256').update(JSON.stringify(row)).digest('hex'))
    const { totalRows, latestDate } = refreshMetadata(db)
    db.exec('COMMIT')
    return { bookingId: id, totalRows, latestDate }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
