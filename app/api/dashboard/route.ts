import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/auth'
import { getDashboardData } from '@/lib/dashboard'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ error: 'Sesi admin tidak valid.' }, { status: 401 })
  return NextResponse.json(await getDashboardData(new URL(request.url).searchParams))
}
