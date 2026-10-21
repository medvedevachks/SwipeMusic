import { isIP } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'

/** Заголовок, который Caddy перезаписывает адресом своего TCP-клиента. */
export const TRUSTED_CLIENT_IP_HEADER = 'x-swipe-client-ip'

function normalizeIp(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || isIP(trimmed) === 0) {
    return null
  }

  const lower = trimmed.toLowerCase()
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1] && isIP(mapped[1]) === 4) {
    return mapped[1]
  }
  return isIP(trimmed) === 6 ? lower : trimmed
}

export function isTrustedProxyPeer(remoteAddress: string | undefined): boolean {
  const normalized = normalizeIp(remoteAddress)
  return normalized === '127.0.0.1' || normalized === '::1'
}

/**
 * Клиентский IP берётся из X-Swipe-Client-Ip только если TCP-сосед — loopback.
 * Произвольный X-Forwarded-For не читается: его может прислать сам клиент.
 * Заголовок принимается лишь как один IP. Список адресов игнорируется.
 * Без заголовка остаётся адрес сокета, чтобы прямой локальный вызов не стал чужим IP.
 */
export function resolveClientIp(
  remoteAddress: string | undefined,
  headers: IncomingHttpHeaders,
): string {
  const peer = normalizeIp(remoteAddress) ?? 'unknown'
  if (!isTrustedProxyPeer(remoteAddress)) {
    return peer
  }

  const raw = headers[TRUSTED_CLIENT_IP_HEADER]
  if (typeof raw !== 'string' || raw.includes(',')) {
    return peer
  }

  return normalizeIp(raw) ?? peer
}
