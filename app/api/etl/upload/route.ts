import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/auth'
import { getDatabase } from '@/lib/database'
import { importCsv, type ImportMode } from '@/lib/csv'

export const runtime = 'nodejs'
export const maxDuration = 60

// Satu endpoint untuk dua metode impor CSV:
//   mode=replace -> timpa seluruh dataset lama dengan dataset baru
//   mode=append  -> tambahkan baris baru ke dataset yang sudah ada (Booking ID duplikat dilewati)
export async function POST(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ error: 'Sesi admin tidak valid.' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file')
  const modeValue = form.get('mode')
  if (modeValue !== 'replace' && modeValue !== 'append') {
    return NextResponse.json({ error: 'Mode impor tidak valid.' }, { status: 400 })
  }
  const mode: ImportMode = modeValue
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.csv')) {
    return NextResponse.json({ error: 'Pilih berkas CSV yang valid.' }, { status: 400 })
  }
  if (file.size === 0 || file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'Ukuran berkas harus lebih dari 0 dan tidak melebihi 50 MB.' }, { status: 400 })
  }

  try {
    const result = importCsv(getDatabase(), await file.text(), file.name, mode)
    return NextResponse.json({ ...result, fileName: file.name })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proses impor CSV gagal.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
