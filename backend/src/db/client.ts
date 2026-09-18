import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
  })
  const db = drizzle(sql, { schema })
  return { sql, db }
}

export type Database = ReturnType<typeof createDb>['db']
