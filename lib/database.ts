import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { neonConfig, Pool, type PoolClient } from '@neondatabase/serverless'
import ws from 'ws'

neonConfig.webSocketConstructor = ws

const globalDatabase = globalThis as typeof globalThis & {
  ncrPool?: Pool
  ncrSchemaPromise?: Promise<void>
  ncrAdminPromise?: Promise<void>
}

type DatabaseRow = Record<string, unknown>
type QueryParameter = string | number | null
type QueryResult = { rows: DatabaseRow[]; rowCount: number | null }
type Queryable = {
  query(query: string, values?: QueryParameter[]): Promise<QueryResult>
}
type NeonDatabase = {
  prepare(sql: string): {
    get(...values: QueryParameter[]): Promise<DatabaseRow | undefined>
    all(...values: QueryParameter[]): Promise<DatabaseRow[]>
    run(...values: QueryParameter[]): Promise<{ changes: number }>
  }
  exec(sql: string): Promise<void>
  transaction<T>(callback: (database: NeonDatabase) => Promise<T>): Promise<T>
}

function getPool() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL belum diatur pada environment aplikasi.')
  globalDatabase.ncrPool ??= new Pool({ connectionString, max: 5 })
  return globalDatabase.ncrPool
}

function parameterize(sql: string) {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

function createDatabase(queryable: Queryable): NeonDatabase {
  return {
    prepare(sql: string) {
      const statement = parameterize(sql)
      return {
        async get(...values: (string | number | null)[]) {
          const result = await queryable.query(statement, values)
          return result.rows[0] as DatabaseRow | undefined
        },
        async all(...values: (string | number | null)[]) {
          const result = await queryable.query(statement, values)
          return result.rows as DatabaseRow[]
        },
        async run(...values: (string | number | null)[]) {
          const result = await queryable.query(statement, values)
          return { changes: result.rowCount ?? 0 }
        },
      }
    },
    async exec(sql: string) {
      for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) {
        await queryable.query(statement)
      }
    },
    async transaction<T>(callback: (database: NeonDatabase) => Promise<T>) {
      const client = await getPool().connect()
      try {
        await client.query('BEGIN')
        const result = await callback(createDatabase(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
  }
}

async function createSchema(pool: Pool) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS rides (
      ride_id BIGSERIAL PRIMARY KEY,
      booking_id TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      booking_time TEXT,
      booking_status TEXT NOT NULL,
      customer_id TEXT,
      vehicle_type TEXT,
      pickup_location TEXT,
      drop_location TEXT,
      avg_vtat DOUBLE PRECISION,
      avg_ctat DOUBLE PRECISION,
      cancelled_by_customer INTEGER,
      cancel_customer_reason TEXT,
      cancelled_by_driver INTEGER,
      cancel_driver_reason TEXT,
      incomplete_rides INTEGER,
      incomplete_reason TEXT,
      booking_value DOUBLE PRECISION,
      ride_distance DOUBLE PRECISION,
      driver_rating DOUBLE PRECISION,
      customer_rating DOUBLE PRECISION,
      payment_method TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS rides_date_idx ON rides (booking_date)',
    'CREATE INDEX IF NOT EXISTS rides_booking_id_idx ON rides (booking_id)',
    'CREATE INDEX IF NOT EXISTS rides_customer_idx ON rides (customer_id)',
    'CREATE INDEX IF NOT EXISTS rides_dimensions_idx ON rides (booking_status, vehicle_type, payment_method)',
    `CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL
    )`,
    'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    `CREATE TABLE IF NOT EXISTS dataset_imports (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  ]
  for (const statement of statements) await pool.query(statement)
}

async function initializeAdmin(database: NeonDatabase) {
  const username = process.env.ADMIN_USERNAME || (process.env.NODE_ENV === 'production' ? '' : 'admin')
  const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin123')
  if (!username || !password) throw new Error('ADMIN_USERNAME dan ADMIN_PASSWORD wajib diatur.')

  const admin = await database.prepare(
    'SELECT username, salt, password_hash FROM admins WHERE id = 1',
  ).get() as { username: string; salt: string; password_hash: string } | undefined
  if (!admin) {
    const salt = randomBytes(16).toString('hex')
    const passwordHash = scryptSync(password, salt, 64).toString('hex')
    await database.prepare(
      'INSERT INTO admins (id, username, salt, password_hash) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    ).run(username, salt, passwordHash)
    return
  }

  const expected = scryptSync(password, admin.salt, 64)
  const stored = Buffer.from(admin.password_hash, 'hex')
  const passwordMatches = stored.length === expected.length && timingSafeEqual(stored, expected)
  if (admin.username !== username || (process.env.ADMIN_PASSWORD && !passwordMatches)) {
    const salt = randomBytes(16).toString('hex')
    const passwordHash = scryptSync(password, salt, 64).toString('hex')
    await database.prepare('UPDATE admins SET username = ?, salt = ?, password_hash = ? WHERE id = 1')
      .run(username, salt, passwordHash)
  }
}

export async function getDatabase() {
  const pool = getPool()
  if (!globalDatabase.ncrSchemaPromise) globalDatabase.ncrSchemaPromise = createSchema(pool)
  try {
    await globalDatabase.ncrSchemaPromise
  } catch (error) {
    globalDatabase.ncrSchemaPromise = undefined
    throw error
  }

  if (!globalDatabase.ncrAdminPromise) {
    globalDatabase.ncrAdminPromise = initializeAdmin(createDatabase(pool))
  }
  try {
    await globalDatabase.ncrAdminPromise
  } catch (error) {
    globalDatabase.ncrAdminPromise = undefined
    throw error
  }
  return createDatabase(pool)
}
