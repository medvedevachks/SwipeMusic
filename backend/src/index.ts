import { serve } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { createAuth } from './auth/createAuth.ts'
import { createApp } from './app.ts'
import { createDb } from './db/client.ts'
import { loadEnv } from './env.ts'
import { createMailer } from './mail/mailer.ts'
import { applyMigrations } from './migrate.ts'

async function main() {
  const env = loadEnv()
  if (process.env.RUN_MIGRATIONS === 'true') {
    await applyMigrations(env.DATABASE_URL)
  }

  const { db, sql } = createDb(env.DATABASE_URL)
  const mailer = createMailer(env)
  const auth = createAuth(env, db, mailer)
  const app = createApp({ auth, db, appOrigin: env.APP_ORIGIN })

  const server = serve({
    fetch: app.fetch,
    hostname: env.HOST,
    port: env.PORT,
  })

  server.on('listening', () => {
    const address = server.address() as AddressInfo | string | null
    if (address && typeof address === 'object') {
      console.log(`backend listening on ${address.address}:${address.port}`)
    }
  })

  const shutdown = () => {
    server.close(() => {
      void sql.end({ timeout: 5 }).finally(() => process.exit(0))
    })
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
