export type ProviderLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ProviderLogger = {
  debug: (message: string, meta?: Record<string, unknown>) => void
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
}

export function createProviderLogger(pluginId: string): ProviderLogger {
  const prefix = `[provider:${pluginId}]`

  const log =
    (level: ProviderLogLevel) =>
    (message: string, meta?: Record<string, unknown>) => {
      const payload = meta ? `${message} ${JSON.stringify(meta)}` : message
      if (level === 'debug') {
        console.debug(`${prefix} ${payload}`)
        return
      }
      if (level === 'info') {
        console.info(`${prefix} ${payload}`)
        return
      }
      if (level === 'warn') {
        console.warn(`${prefix} ${payload}`)
        return
      }
      console.error(`${prefix} ${payload}`)
    }

  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  }
}
