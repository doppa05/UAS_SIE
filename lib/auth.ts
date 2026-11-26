import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { getDatabase } from './database'

export const SESSION_COOKIE = 'ncr_admin_session'
const SESSION_TTL_SECONDS = 60 * 60 * 8

export function verifyAdmin(username: string, password: string) {
  const admin = getDatabase().prepare(
    'SELECT username, salt, password_hash FROM admins WHERE id = 1',
  ).get() as { username: string; salt: string; password_hash: string } | undefined
  if (!admin || admin.username !== username) return false
  const actual = scryptSync(password, admin.salt, 64)
  const expected = Buffer.from(admin.password_hash, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function sessionSecret() {
  const db = getDatabase()
  let setting = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get() as { value: string } | undefined
  if (!setting) {
    const value = randomBytes(32).toString('hex')
    db.prepare("INSERT INTO settings (key, value) VALUES ('session_secret', ?)").run(value)
    setting = { value }
  }
  return setting.value
}

export function createSessionToken() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const nonce = randomBytes(16).toString('hex')
  const payload = `admin:${expires}:${nonce}`
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('hex')
  return { token: `${payload}:${signature}`, maxAge: SESSION_TTL_SECONDS }
}

export async function hasAdminSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return false
  const [role, expiresText, nonce, signature, ...rest] = token.split(':')
  const expires = Number(expiresText)
  if (role !== 'admin' || !nonce || !signature || rest.length || !Number.isSafeInteger(expires) || expires <= Date.now() / 1000) {
    return false
  }
  const payload = `${role}:${expiresText}:${nonce}`
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest()
  let received: Buffer
  try {
    received = Buffer.from(signature, 'hex')
  } catch {
    return false
  }
  return expected.length === received.length && timingSafeEqual(expected, received)
}
