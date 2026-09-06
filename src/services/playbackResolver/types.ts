/** Тип способа воспроизведения — без привязки к конкретному сервису. */
export type PlaybackCandidateType = 'local' | 'stream' | 'preview' | 'remote'

/**
 * Один возможный способ сыграть трек.
 * Player видит только выбранный кандидат (url), не Premium / Spotify / …
 */
export type PlaybackCandidate = {
  /** Стабильный id для Dev override: `${providerId}:${type}` */
  id: string
  providerId: string
  type: PlaybackCandidateType
  /** Чем выше — тем предпочтительнее (после ранжирования Resolver). */
  priority: number
  available: boolean
  reason?: string
  /** Готовый URL / URI (blob:, https:, spotify:…). */
  url?: string | null
  /** Подпись для UI, напр. "30 sec preview". */
  label?: string
  requiresPremium?: boolean
}

export type PlaybackResolution = {
  trackId: string
  candidate: PlaybackCandidate
  url: string
  /** Все рассмотренные кандидаты (для Dev panel). */
  candidates: PlaybackCandidate[]
}

export type PlaybackResolverConfig = {
  /** Базовый приоритет по типу (настраивается). */
  typePriority: Record<PlaybackCandidateType, number>
  /** Доп. вес providerId → delta. */
  providerBoost: Record<string, number>
}

export const DEFAULT_PLAYBACK_RESOLVER_CONFIG: PlaybackResolverConfig = {
  typePriority: {
    local: 1000,
    remote: 800,
    stream: 600,
    preview: 200,
  },
  providerBoost: {
    'local-folder': 50,
    plex: 40,
    jellyfin: 40,
    nas: 40,
    spotify: 0,
    mock: 10,
  },
}

export type DevPlaybackOverride = {
  candidateId: string
} | null
