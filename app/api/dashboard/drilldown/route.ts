import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/auth'
import { getDrilldownData } from '@/lib/dashboard'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!await hasAdminSession()) {
    return NextResponse.json({ error: 'Sesi admin tidak valid.' }, { status: 401 })
  }
  try {
    return NextResponse.json(getDrilldownData(new URL(request.url).searchParams))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Data drill down gagal dimuat.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
