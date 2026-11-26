import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/auth'
import { getDatabase } from '@/lib/database'
import { insertManualRide, type ManualRideInput } from '@/lib/csv'

export const runtime = 'nodejs'

// Input manual satu baris pemesanan tidak bergantung pada unggahan CSV.
export async function POST(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ error: 'Sesi admin tidak valid.' }, { status: 401 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Data form tidak valid.' }, { status: 400 })
  }

  const serialized = form.get('data')
  if (typeof serialized !== 'string') {
    return NextResponse.json({ error: 'Data form tidak valid.' }, { status: 400 })
  }

  let body: ManualRideInput
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Data form tidak valid.' }, { status: 400 })
    }
    body = parsed
  } catch {
    return NextResponse.json({ error: 'Data form tidak valid.' }, { status: 400 })
  }

  try {
    return NextResponse.json(insertManualRide(getDatabase(), body))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Data gagal disimpan.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
