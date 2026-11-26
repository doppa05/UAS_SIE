import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/auth'
import { deleteSelectedRides } from '@/lib/csv'
import { getDatabase } from '@/lib/database'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ error: 'Sesi admin tidak valid.' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Daftar pemesanan yang dipilih tidak valid.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Daftar pemesanan yang dipilih tidak valid.' }, { status: 400 })
  }
  const rideIds = (body as Record<string, unknown>).rideIds
  if (!Array.isArray(rideIds) || rideIds.length === 0 || rideIds.length > 1000 ||
      !rideIds.every((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) {
    return NextResponse.json({ error: 'Pilih antara 1 dan 1000 baris yang valid untuk dihapus.' }, { status: 400 })
  }

  try {
    return NextResponse.json(deleteSelectedRides(getDatabase(), rideIds))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Baris yang dipilih gagal dihapus.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
