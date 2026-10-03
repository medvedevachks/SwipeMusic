export type MatchDecision = 'MATCH' | 'NO_MATCH' | 'AMBIGUOUS'

export type MatchInput = {
  title: string
  artist: string
  durationMs?: number | null
}

const DURATION_TOLERANCE_MS = 3_000

const VERSION_MARKERS = [
  'radio edit',
  'sped up',
  'instrumental',
  'karaoke',
  'remix',
  'cover',
  'live',
]

export function matchSourceCopies(left: MatchInput, right: MatchInput): MatchDecision {
  if (!hasText(left.title) || !hasText(left.artist) || !hasText(right.title) || !hasText(right.artist)) {
    return 'NO_MATCH'
  }
  if (left.durationMs == null || right.durationMs == null) {
    return 'NO_MATCH'
  }
  if (!Number.isFinite(left.durationMs) || !Number.isFinite(right.durationMs)) {
    return 'NO_MATCH'
  }

  if (normalizeText(left.artist) !== normalizeText(right.artist)) {
    return 'NO_MATCH'
  }

  const leftMarker = versionMarker(left.title)
  const rightMarker = versionMarker(right.title)
  if (leftMarker !== rightMarker) {
    return 'AMBIGUOUS'
  }

  if (normalizeText(left.title) !== normalizeText(right.title)) {
    return 'NO_MATCH'
  }

  const delta = Math.abs(left.durationMs - right.durationMs)
  if (delta <= DURATION_TOLERANCE_MS) {
    return 'MATCH'
  }
  return 'NO_MATCH'
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function versionMarker(title: string): string | null {
  const normalized = normalizeText(title)
  for (const marker of VERSION_MARKERS) {
    const pattern = new RegExp(`(?:^| )${marker}(?:$| )`)
    if (pattern.test(normalized)) {
      return marker
    }
  }
  return null
}
