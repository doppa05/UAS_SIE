import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const globalDatabase = globalThis as typeof globalThis & {
  ncrDatabase?: DatabaseSync
  ncrBundledSeedCleanupComplete?: boolean
}

function removeUnusedBundledSeed(db: DatabaseSync) {
  const seed = db.prepare("SELECT row_count FROM dataset_imports WHERE source = 'initial-csv'").get() as
    { row_count: number } | undefined
  if (!seed) return

  const importCount = Number(db.prepare('SELECT COUNT(*) AS count FROM dataset_imports').get()?.count ?? 0)
  const rowCount = Number(db.prepare('SELECT COUNT(*) AS count FROM rides').get()?.count ?? 0)
  if (importCount !== 1 || rowCount !== seed.row_count) return

  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('DELETE FROM rides; DELETE FROM dataset_imports; DELETE FROM metadata;')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function createDatabase() {
  const file = join(process.cwd(), 'data', 'uber-ncr.sqlite')
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS rides (
      ride_id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      booking_time TEXT,
      booking_status TEXT NOT NULL,
      customer_id TEXT,
      vehicle_type TEXT,
      pickup_location TEXT,
      drop_location TEXT,
      avg_vtat REAL,
      avg_ctat REAL,
      cancelled_by_customer INTEGER,
      cancel_customer_reason TEXT,
      cancelled_by_driver INTEGER,
      cancel_driver_reason TEXT,
      incomplete_rides INTEGER,
      incomplete_reason TEXT,
      booking_value REAL,
      ride_distance REAL,
      driver_rating REAL,
      customer_rating REAL,
      payment_method TEXT
    );
    CREATE INDEX IF NOT EXISTS rides_date_idx ON rides (booking_date);
    CREATE INDEX IF NOT EXISTS rides_booking_id_idx ON rides (booking_id);
    CREATE INDEX IF NOT EXISTS rides_customer_idx ON rides (customer_id);
    CREATE INDEX IF NOT EXISTS rides_dimensions_idx ON rides (booking_status, vehicle_type, payment_method);
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dataset_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || 'admin123'
  const admin = db.prepare('SELECT username, salt, password_hash FROM admins WHERE id = 1').get() as
    { username: string; salt: string; password_hash: string } | undefined
  if (!admin) {
    const salt = randomBytes(16).toString('hex')
    const passwordHash = scryptSync(password, salt, 64).toString('hex')
    db.prepare('INSERT INTO admins (id, username, salt, password_hash) VALUES (1, ?, ?, ?)')
      .run(username, salt, passwordHash)
  } else {
    const expected = scryptSync(password, admin.salt, 64)
    const stored = Buffer.from(admin.password_hash, 'hex')
    const passwordMatches = stored.length === expected.length && timingSafeEqual(stored, expected)
    if (admin.username !== username || (process.env.ADMIN_PASSWORD && !passwordMatches)) {
      const salt = randomBytes(16).toString('hex')
      const passwordHash = scryptSync(password, salt, 64).toString('hex')
      db.prepare('UPDATE admins SET username = ?, salt = ?, password_hash = ? WHERE id = 1')
        .run(username, salt, passwordHash)
    }
  }

  return db
}

export function getDatabase() {
  globalDatabase.ncrDatabase ??= createDatabase()
  if (!globalDatabase.ncrBundledSeedCleanupComplete) {
    removeUnusedBundledSeed(globalDatabase.ncrDatabase)
    globalDatabase.ncrBundledSeedCleanupComplete = true
  }
  return globalDatabase.ncrDatabase
}
