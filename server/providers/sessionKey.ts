import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AppConfig } from '../config/env.ts'
import { parseProviderSessionKey } from './sessionCrypto.ts'

export function readOrCreateDevProviderSessionKey(filePath: string): Buffer {
  if (existsSync(filePath)) {
    return parseProviderSessionKey(readFileSync(filePath, 'utf8'))
  }
  mkdirSync(dirname(filePath), { recursive: true })
  const encoded = randomBytes(32).toString('base64')
  writeFileSync(filePath, encoded, { encoding: 'utf8', mode: 0o600 })
  return parseProviderSessionKey(encoded)
}

export function attachProviderSessionKey(config: AppConfig): AppConfig {
  if (config.providerSessionKey) {
    return config
  }
  if (config.nodeEnv !== 'development') {
    throw new Error('PROVIDER_SESSION_KEY is invalid')
  }
  return {
    ...config,
    providerSessionKey: readOrCreateDevProviderSessionKey(
      join(process.cwd(), '.data', 'provider-session.key'),
    ),
  }
}
