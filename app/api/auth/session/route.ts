import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/auth'
import { getDatabase } from '@/lib/database'
import { getDashboardData } from '@/lib/dashboard'

export const runtime = 'nodejs'

export async function GET() {
  if (!await hasAdminSession()) return NextResponse.json({ authenticated: false })
  const database = await getDatabase()
  const count = Number((await database.prepare('SELECT COUNT(*) AS count FROM rides').get())?.count ?? 0)
  const latestDate = String((await database.prepare("SELECT value FROM metadata WHERE key = 'latest_date'").get())?.value ?? '')
  const dashboard = await getDashboardData(new URLSearchParams())
  return NextResponse.json({
    authenticated: true,
    username: process.env.ADMIN_USERNAME || 'admin',
    rowCount: count,
    latestDate,
    summary: { agg: dashboard.agg, prev: dashboard.prev },
  })
}
