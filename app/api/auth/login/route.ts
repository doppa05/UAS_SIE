import { NextResponse } from 'next/server'
import { createSessionToken, SESSION_COOKIE, verifyAdmin } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { username?: unknown; password?: unknown } | null
  if (typeof body?.username !== 'string' || typeof body.password !== 'string' ||
      !verifyAdmin(body.username, body.password)) {
    return NextResponse.json({ error: 'Nama pengguna atau kata sandi salah.' }, { status: 401 })
  }

  const session = createSessionToken()
  const response = NextResponse.json({ username: body.username })
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAge,
  })
  return response
}
