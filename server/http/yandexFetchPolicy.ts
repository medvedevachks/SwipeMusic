import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/**
 * download-info XML текущего playback приходит с
 * https://storage.mds.yandex.net/file-download-info/...
 * Прямой mp3-host из XML сюда не проксируется.
 */
export const YANDEX_METADATA_HOST = 'storage.mds.yandex.net'

const MAX_REDIRECTS = 3

const blocked = new BlockList()
blocked.addSubnet('0.0.0.0', 8, 'ipv4')
blocked.addSubnet('10.0.0.0', 8, 'ipv4')
blocked.addSubnet('127.0.0.0', 8, 'ipv4')
blocked.addSubnet('169.254.0.0', 16, 'ipv4')
blocked.addSubnet('172.16.0.0', 12, 'ipv4')
blocked.addSubnet('192.168.0.0', 16, 'ipv4')
blocked.addSubnet('224.0.0.0', 4, 'ipv4')
blocked.addAddress('::1', 'ipv6')
blocked.addSubnet('fc00::', 7, 'ipv6')
blocked.addSubnet('fe80::', 10, 'ipv6')

export type HostResolver = (hostname: string) => Promise<string[]>

export async function resolveHostAddresses(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

export type FetchTarget =
  | { ok: true; url: URL }
  | { ok: false }

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '')
}

export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) {
    return true
  }
  const lower = address.toLowerCase()
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length)
    if (isIP(mapped) === 4) {
      return isForbiddenAddress(mapped)
    }
  }
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHost(hostname)
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.localdomain')
  )
}

export function isAllowedMetadataHost(hostname: string): boolean {
  return normalizeHost(hostname) === YANDEX_METADATA_HOST
}

export async function validateMetadataTarget(
  raw: string,
  resolveHost: HostResolver = resolveHostAddresses,
): Promise<FetchTarget> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false }
  }
  if (url.protocol !== 'https:') {
    return { ok: false }
  }
  if (url.username || url.password) {
    return { ok: false }
  }
  if (isBlockedHostname(url.hostname)) {
    return { ok: false }
  }
  if (isIP(url.hostname) !== 0) {
    if (isForbiddenAddress(url.hostname) || !isAllowedMetadataHost(url.hostname)) {
      return { ok: false }
    }
    return { ok: true, url }
  }
  if (!isAllowedMetadataHost(url.hostname)) {
    return { ok: false }
  }
  let addresses: string[]
  try {
    addresses = await resolveHost(url.hostname)
  } catch {
    return { ok: false }
  }
  if (addresses.length === 0 || addresses.some((address) => isForbiddenAddress(address))) {
    return { ok: false }
  }
  return { ok: true, url }
}

export async function nextRedirectTarget(
  current: URL,
  location: string | null,
  resolveHost: HostResolver,
): Promise<FetchTarget> {
  if (!location) {
    return { ok: false }
  }
  let next: URL
  try {
    next = new URL(location, current)
  } catch {
    return { ok: false }
  }
  return validateMetadataTarget(next.toString(), resolveHost)
}

export const YANDEX_FETCH_MAX_REDIRECTS = MAX_REDIRECTS
