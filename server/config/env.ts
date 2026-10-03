export type AppConfig = {
  port: number
  nodeEnv: string
  databasePath: string
  cookieSecure: boolean
  sessionTtlMs: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV?.trim() || 'development'
  const port = Number(env.PORT ?? 8787)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Invalid PORT')
  }

  return {
    port,
    nodeEnv,
    databasePath: env.DATABASE_PATH?.trim() || '.data/swipemusic.sqlite',
    cookieSecure: nodeEnv === 'production',
    sessionTtlMs: 30 * DAY_MS,
  }
}
