/**
 * Публичный runtime-флаг SessionSwitch (PLAYBACK-RELEASE-01).
 * Не содержит секретов. Ошибка чтения → OFF.
 *
 * Файл `.data/session-switch.flag` важнее env:
 * содержимое ровно `1` включает движок, любое другое содержимое выключает.
 * Файла нет — смотрим SWIPE_SESSION_SWITCH=1. Иначе OFF.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from './currentUser.ts'

export const RUNTIME_CONFIG_PATH = '/api/runtime-config'
export const SESSION_SWITCH_FLAG_FILENAME = 'session-switch.flag'

export function sessionSwitchFlagPath(cwd = process.cwd()): string {
  return join(cwd, '.data', SESSION_SWITCH_FLAG_FILENAME)
}

export function resolveSessionSwitchEnabled(input: {
  fileText: string | null
  fileError: boolean
  envValue: string | undefined
}): boolean {
  if (input.fileError) {
    return false
  }
  if (input.fileText !== null) {
    return input.fileText.replace(/^\uFEFF/, '').trim() === '1'
  }
  return input.envValue === '1'
}

export function readSessionSwitchEnabled(
  env: NodeJS.ProcessEnv = process.env,
  flagPath = sessionSwitchFlagPath(),
): boolean {
  let fileText: string | null = null
  let fileError = false
  try {
    if (existsSync(flagPath)) {
      fileText = readFileSync(flagPath, 'utf8')
    }
  } catch {
    fileError = true
  }
  return resolveSessionSwitchEnabled({
    fileText,
    fileError,
    envValue: env.SWIPE_SESSION_SWITCH,
  })
}

export function handleRuntimeConfig(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if ((req.method ?? 'GET') !== 'GET') {
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }
  sendJson(res, 200, { sessionSwitch: readSessionSwitchEnabled() })
}
