import { NextResponse } from 'next/server'
import { createSessionToken, SESSION_COOKIE, verifyAdmin } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown } | null
  try {
    body = await request.json() as { username?: unknown; password?: unknown }
  } catch {
    return NextResponse.json({ error: 'Data login tidak valid.' }, { status: 400 })
  }
  if (typeof body?.username !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ error: 'Nama pengguna atau kata sandi salah.' }, { status: 401 })
  }

  try {
    if (!await verifyAdmin(body.username, body.password)) {
      return NextResponse.json({ error: 'Nama pengguna atau kata sandi salah.' }, { status: 401 })
    }

    const session = await createSessionToken()
    const response = NextResponse.json({ username: body.username })
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: session.maxAge,
    })
    return response
  } catch (error) {
    console.error('Login gagal karena database tidak tersedia.', error)
    return NextResponse.json({ error: 'Layanan login tidak tersedia. Periksa konfigurasi database di Vercel.' }, { status: 503 })
  }
}
