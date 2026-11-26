import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/auth'
import { clearDataset } from '@/lib/csv'
import { getDatabase } from '@/lib/database'

export const runtime = 'nodejs'

export async function POST() {
  if (!await hasAdminSession()) return NextResponse.json({ error: 'Sesi admin tidak valid.' }, { status: 401 })

  try {
    return NextResponse.json(await clearDataset(await getDatabase()))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dataset gagal dihapus.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
