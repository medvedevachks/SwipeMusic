import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { loadEnv } from './env.ts'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../drizzle',
)

export async function applyMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined })

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id integer PRIMARY KEY,
        name text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const locked = await sql<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(87216401) AS locked
    `
    if (!locked[0]?.locked) {
      throw new Error('Другой процесс уже выполняет миграции')
    }

    try {
      const files = (await readdir(MIGRATIONS_DIR))
        .filter((name) => /^\d+_.*\.sql$/.test(name))
        .sort()

      const applied = await sql<{ name: string }[]>`
        SELECT name FROM schema_migrations ORDER BY id
      `
      const appliedSet = new Set(applied.map((row) => row.name))

      for (const file of files) {
        if (appliedSet.has(file)) {
          continue
        }

        const id = Number.parseInt(file.split('_')[0] ?? '', 10)
        if (Number.isNaN(id)) {
          throw new Error(`Некорректное имя миграции: ${file}`)
        }

        const body = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
        await sql.begin(async (tx) => {
          await tx.unsafe(body)
          await tx`
            INSERT INTO schema_migrations (id, name) VALUES (${id}, ${file})
          `
        })
      }
    } finally {
      await sql`SELECT pg_advisory_unlock(87216401)`
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

function assertRoleName(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error('Некорректное имя роли PostgreSQL')
  }
  return value
}

export async function grantAppRole(databaseUrl: string, appUser: string): Promise<void> {
  const role = assertRoleName(appUser)
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  try {
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    )
    await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`)
    await sql.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function main() {
  const env = loadEnv()
  await applyMigrations(env.DATABASE_URL)
  const appUser = process.env.POSTGRES_APP_USER
  if (appUser) {
    await grantAppRole(env.DATABASE_URL, appUser)
  }
  console.log('Migrations applied')
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]).includes('migrate')
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
