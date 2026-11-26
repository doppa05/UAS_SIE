import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/auth'
import { getDatabase } from '@/lib/database'

export const runtime = 'nodejs'

const PAGE_SIZE = 15

// Menampilkan seluruh isi dataset di database (berpaginasi) agar hasil ETL bisa diperiksa.
export async function GET(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ error: 'Sesi admin tidak valid.' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const db = await getDatabase()
  const q = (params.get('q') ?? '').trim()
  const page = Math.max(1, Math.min(1_000_000, Number(params.get('page')) || 1))
  const direction = params.get('order') === 'desc' ? 'DESC' : 'ASC'

  const totalAll = Number((await db.prepare('SELECT COUNT(*) AS c FROM rides').get())?.c ?? 0)
  const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`
  const where = q
    ? "WHERE booking_id LIKE ? ESCAPE '\\' OR customer_id LIKE ? ESCAPE '\\' OR pickup_location LIKE ? ESCAPE '\\' OR drop_location LIKE ? ESCAPE '\\'"
    : ''
  const args = q ? [like, like, like, like] : []
  const total = q ? Number((await db.prepare(`SELECT COUNT(*) AS c FROM rides ${where}`).get(...args))?.c ?? 0) : totalAll

  const rows = await db.prepare(`
    SELECT ride_id, booking_id, booking_date, booking_time, booking_status, customer_id, vehicle_type,
      pickup_location, drop_location, avg_vtat, avg_ctat, booking_value, ride_distance,
      driver_rating, customer_rating, payment_method
    FROM rides ${where}
    ORDER BY ride_id ${direction} LIMIT ? OFFSET ?
  `).all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE)

  return NextResponse.json({ rows, total, totalAll, page, pageSize: PAGE_SIZE })
}
