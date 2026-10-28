import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Безопасная DEV-диагностика login: без пароля, cookie, token, session, hash. */
export type DevLoginDiag = {
  requestId: string
  at: string
  route: '/api/auth/login'
  httpStatus: number
  errorCode: string | null
  userExists: boolean | null
  passwordOk: boolean | null
  rateLimited: boolean
  databasePath: string
  pid: number
  passwordLength: number | null
  passwordHadWhitespaceEdges: boolean | null
}

let lastDiag: DevLoginDiag | null = null

function diagFilePath(databasePath: string): string | null {
  const normalized = databasePath.replace(/\\/g, '/')
  if (!normalized.includes('/dev-acceptance/')) {
    return null
  }
  return join(dirname(databasePath), 'last-login-diag.json')
}

export function isDevAuthDiagEnabled(nodeEnv: string): boolean {
  return nodeEnv !== 'production'
}

export function recordDevLoginDiag(
  input: Omit<DevLoginDiag, 'requestId' | 'at' | 'route' | 'pid'> & {
    requestId?: string
  },
): DevLoginDiag {
  const diag: DevLoginDiag = {
    requestId: input.requestId ?? randomUUID(),
    at: new Date().toISOString(),
    route: '/api/auth/login',
    httpStatus: input.httpStatus,
    errorCode: input.errorCode,
    userExists: input.userExists,
    passwordOk: input.passwordOk,
    rateLimited: input.rateLimited,
    databasePath: input.databasePath,
    pid: process.pid,
    passwordLength: input.passwordLength,
    passwordHadWhitespaceEdges: input.passwordHadWhitespaceEdges,
  }
  lastDiag = diag

  const line = `[dev-login-diag] ${JSON.stringify(diag)}`
  console.info(line)

  const filePath = diagFilePath(input.databasePath)
  if (filePath) {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, `${JSON.stringify(diag, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.warn(
        '[dev-login-diag] file write failed:',
        error instanceof Error ? error.name : 'Error',
      )
    }
  }

  return diag
}

export function getLastDevLoginDiag(): DevLoginDiag | null {
  return lastDiag
}

export function devLoginDiagHeader(diag: DevLoginDiag): Record<string, string> {
  return {
    'X-Swipe-Dev-Auth': JSON.stringify({
      requestId: diag.requestId,
      httpStatus: diag.httpStatus,
      errorCode: diag.errorCode,
      userExists: diag.userExists,
      passwordOk: diag.passwordOk,
      rateLimited: diag.rateLimited,
      pid: diag.pid,
      passwordLength: diag.passwordLength,
      passwordHadWhitespaceEdges: diag.passwordHadWhitespaceEdges,
    }),
  }
}
