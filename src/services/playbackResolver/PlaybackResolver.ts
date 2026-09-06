import type { MusicSourceAdapter } from '../../sources/MusicSourceAdapter'
import type { Track } from '../../types/track'
import { getMediaIndex } from '../mediaIndex'
import { bootstrapMusicSources, sourceManager, sourceRegistry } from '../../sources'
import type {
  DevPlaybackOverride,
  PlaybackCandidate,
  PlaybackCandidateType,
  PlaybackResolution,
  PlaybackResolverConfig,
} from './types'
import {
  DEFAULT_PLAYBACK_RESOLVER_CONFIG,
} from './types'

type ResolverListener = (resolution: PlaybackResolution | null) => void

function normalizeKey(title: string, artist: string): string {
  return `${title.trim().toLowerCase()}|${artist.trim().toLowerCase()}`
}

function scoreCandidate(
  candidate: PlaybackCandidate,
  config: PlaybackResolverConfig,
): number {
  const typeScore = config.typePriority[candidate.type] ?? 0
  const boost = config.providerBoost[candidate.providerId] ?? 0
  return candidate.priority + typeScore + boost
}

/**
 * Централизованный выбор лучшего способа воспроизведения.
 * Player / Queue / UI не содержат логики Premium / preview / Local.
 */
export class PlaybackResolver {
  private config: PlaybackResolverConfig = {
    ...DEFAULT_PLAYBACK_RESOLVER_CONFIG,
    typePriority: { ...DEFAULT_PLAYBACK_RESOLVER_CONFIG.typePriority },
    providerBoost: { ...DEFAULT_PLAYBACK_RESOLVER_CONFIG.providerBoost },
  }
  private lastResolution: PlaybackResolution | null = null
  private lastCandidates: PlaybackCandidate[] = []
  private devOverride: DevPlaybackOverride = null
  private readonly listeners = new Set<ResolverListener>()

  getConfig(): PlaybackResolverConfig {
    return {
      typePriority: { ...this.config.typePriority },
      providerBoost: { ...this.config.providerBoost },
    }
  }

  setConfig(partial: Partial<PlaybackResolverConfig>): void {
    if (partial.typePriority) {
      this.config.typePriority = {
        ...this.config.typePriority,
        ...partial.typePriority,
      }
    }
    if (partial.providerBoost) {
      this.config.providerBoost = {
        ...this.config.providerBoost,
        ...partial.providerBoost,
      }
    }
  }

  getLastResolution(): PlaybackResolution | null {
    return this.lastResolution
  }

  getLastCandidates(): PlaybackCandidate[] {
    return [...this.lastCandidates]
  }

  getDevOverride(): DevPlaybackOverride {
    return this.devOverride
  }

  /** Только development: принудительный candidateId. */
  setDevOverride(override: DevPlaybackOverride): void {
    if (!import.meta.env.DEV) {
      return
    }
    this.devOverride = override
  }

  subscribe(listener: ResolverListener): () => void {
    this.listeners.add(listener)
    listener(this.lastResolution)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Выбрать лучший доступный PlaybackCandidate для трека.
   * Собирает кандидатов от всех релевантных Provider.
   */
  async resolve(track: Track): Promise<PlaybackResolution | null> {
    bootstrapMusicSources()
    sourceManager.listSources()

    const relatedTracks = await this.collectRelatedTracks(track)
    const all: PlaybackCandidate[] = []

    for (const related of relatedTracks) {
      const fromProvider = await this.collectFromProvider(related)
      all.push(...fromProvider)
    }

    this.lastCandidates = all

    const available = all.filter(
      (item) => item.available && Boolean(item.url?.trim()),
    )

    let chosen: PlaybackCandidate | undefined

    if (this.devOverride?.candidateId && import.meta.env.DEV) {
      chosen = available.find((item) => item.id === this.devOverride?.candidateId)
      if (!chosen) {
        const forced = all.find((item) => item.id === this.devOverride?.candidateId)
        this.publish(null)
        throw new Error(
          forced?.reason ??
            `Dev override: кандидат «${this.devOverride.candidateId}» недоступен`,
        )
      }
    } else {
      chosen = [...available].sort(
        (a, b) => scoreCandidate(b, this.config) - scoreCandidate(a, this.config),
      )[0]
    }

    if (!chosen?.url) {
      this.publish(null)
      return null
    }

    const resolution: PlaybackResolution = {
      trackId: track.id,
      candidate: chosen,
      url: chosen.url,
      candidates: all,
    }
    this.publish(resolution)
    return resolution
  }

  /** Сообщение, если resolve вернул null. */
  buildUnavailableMessage(candidates: PlaybackCandidate[] = this.lastCandidates): string {
    const premiumBlocked = candidates.some(
      (item) => item.requiresPremium && !item.available,
    )
    const hadPreview = candidates.some((item) => item.type === 'preview')
    const previewMissing = candidates.some(
      (item) => item.type === 'preview' && !item.available,
    )

    if (premiumBlocked && (!hadPreview || previewMissing)) {
      return 'Полная версия трека недоступна. Для Spotify требуется Premium.'
    }
    if (candidates.length === 0) {
      return 'Нет доступного источника воспроизведения'
    }
    const reasons = candidates
      .map((item) => item.reason)
      .filter(Boolean)
      .slice(0, 2)
    if (reasons.length > 0) {
      return reasons.join(' · ')
    }
    return 'Нет доступного источника воспроизведения'
  }

  private publish(resolution: PlaybackResolution | null): void {
    this.lastResolution = resolution
    for (const listener of this.listeners) {
      listener(resolution)
    }
  }

  private async collectRelatedTracks(track: Track): Promise<Track[]> {
    const byId = new Map<string, Track>()
    byId.set(track.id, track)

    try {
      const index = getMediaIndex()
      await index.whenReady()
      const record = index.get(track.id)
      if (record) {
        for (const copy of record.copies) {
          if (!copy.available) {
            continue
          }
          const copyTrack: Track = {
            ...record.track,
            id: `${copy.sourceId}:${copy.externalId}`,
            sourceId: copy.sourceId,
            externalId: copy.externalId,
          }
          byId.set(copyTrack.id, copyTrack)
        }
      }

      const key = normalizeKey(track.title, track.artist)
      for (const row of index.list()) {
        if (normalizeKey(row.track.title, row.track.artist) === key) {
          byId.set(row.track.id, row.track)
          for (const copy of row.copies) {
            if (!copy.available) {
              continue
            }
            const copyTrack: Track = {
              ...row.track,
              id: `${copy.sourceId}:${copy.externalId}`,
              sourceId: copy.sourceId,
              externalId: copy.externalId,
            }
            byId.set(copyTrack.id, copyTrack)
          }
        }
      }
    } catch {
      // MediaIndex ещё не готов — только исходный трек.
    }

    return [...byId.values()]
  }

  private async collectFromProvider(track: Track): Promise<PlaybackCandidate[]> {
    if (!sourceRegistry.has(track.sourceId)) {
      return []
    }

    const adapter = sourceRegistry.get(track.sourceId)
    const available = await adapter.isAvailable()
    if (!available && track.sourceId !== 'mock') {
      // mock всегда; для остальных — всё равно спросим candidates (preview может не требовать session? Spotify needs session)
      // Spotify without auth: no candidates
    }

    if (typeof adapter.getPlaybackCandidates === 'function') {
      try {
        return await adapter.getPlaybackCandidates(track)
      } catch {
        return []
      }
    }

    return this.fallbackCandidates(adapter, track)
  }

  private async fallbackCandidates(
    adapter: MusicSourceAdapter,
    track: Track,
  ): Promise<PlaybackCandidate[]> {
    const type: PlaybackCandidateType =
      adapter.type === 'filesystem'
        ? 'local'
        : track.previewUrl && !adapter.supportsStreaming
          ? 'preview'
          : 'stream'

    try {
      const available = await adapter.isAvailable()
      if (!available) {
        return [
          {
            id: `${adapter.id}:${type}`,
            providerId: adapter.id,
            type,
            priority: 0,
            available: false,
            reason: `Источник «${adapter.label}» недоступен`,
          },
        ]
      }
      const url = await adapter.getStream(track)
      return [
        {
          id: `${adapter.id}:${type}`,
          providerId: adapter.id,
          type,
          priority: 0,
          available: Boolean(url),
          url,
        },
      ]
    } catch (error) {
      return [
        {
          id: `${adapter.id}:${type}`,
          providerId: adapter.id,
          type,
          priority: 0,
          available: false,
          reason: error instanceof Error ? error.message : String(error),
        },
      ]
    }
  }
}

let singleton: PlaybackResolver | null = null

export function getPlaybackResolver(): PlaybackResolver {
  if (!singleton) {
    singleton = new PlaybackResolver()
  }
  return singleton
}
