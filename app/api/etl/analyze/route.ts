import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/auth'
import { getDatabase } from '@/lib/database'
import { analyzeCsv } from '@/lib/csv'

export const runtime = 'nodejs'
export const maxDuration = 60

// Langkah 1 ETL: unggah & analisis berkas CSV. Tidak mengubah database sama sekali.
export async function POST(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ error: 'Sesi admin tidak valid.' }, { status: 401 })
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.csv')) {
    return NextResponse.json({ error: 'Pilih berkas CSV yang valid.' }, { status: 400 })
  }
  if (file.size === 0 || file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'Ukuran berkas harus lebih dari 0 dan tidak melebihi 50 MB.' }, { status: 400 })
  }
  const db = await getDatabase()
  const analysis = await analyzeCsv(db, await file.text())
  const existingRows = Number((await db.prepare('SELECT COUNT(*) AS c FROM rides').get())?.c ?? 0)
  return NextResponse.json({ ...analysis, fileName: file.name, fileSize: file.size, databaseRows: existingRows })
}
