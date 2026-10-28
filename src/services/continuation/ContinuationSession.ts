import type { SearchSeedPlaybackContext } from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'
import {
  isContinuationCandidateAvailable,
  type ContinuationProvider,
  type ContinuationSignal,
} from './types.ts'

/**
 * Поколение, отмена и один inflight на текущий трек.
 * Не знает про поиск по исполнителю и не пишет в PlaybackQueue.
 */
export class ContinuationSession {
  private generation = 0
  private signal: ContinuationSignal = { generation: 0, aborted: false }
  private provider: ContinuationProvider
  private prepared: Track | null = null
  private inflightKey: string | null = null
  private inflightPromise: Promise<void> | null = null

  constructor(provider: ContinuationProvider = emptyContinuationProvider) {
    this.provider = provider
  }

  setProvider(provider: ContinuationProvider): void {
    this.cancel()
    this.provider = provider
  }

  currentGeneration(): number {
    return this.generation
  }

  peekPrepared(): Track | null {
    return this.prepared
  }

  /** Забирает готового кандидата. Повторный вызов не вернёт тот же трек. */
  takePrepared(): Track | null {
    const track = this.prepared
    this.prepared = null
    return track
  }

  /**
   * @param force — явный новый выбор трека: не склеивать с уже идущим запросом.
   */
  prepare(
    currentTrack: Track,
    context: SearchSeedPlaybackContext,
    options?: { force?: boolean },
  ): number {
    const key = `${context.seedTrackId}:${context.query}:${currentTrack.id}`
    if (
      !options?.force &&
      this.inflightKey === key &&
      this.inflightPromise &&
      !this.signal.aborted
    ) {
      return this.generation
    }

    this.signal.aborted = true
    const generation = ++this.generation
    const signal: ContinuationSignal = { generation, aborted: false }
    this.signal = signal
    this.prepared = null
    this.inflightKey = key

    const promise = this.provider
      .prepareContinuation(currentTrack, context, signal)
      .then((candidate) => {
        if (signal.aborted || signal.generation !== this.generation) {
          return
        }
        const track = candidate?.track ?? null
        if (!isContinuationCandidateAvailable(track, currentTrack.id, [])) {
          this.prepared = null
          return
        }
        this.prepared = track
      })
      .catch(() => {
        if (signal.aborted || signal.generation !== this.generation) {
          return
        }
        this.prepared = null
      })
      .finally(() => {
        if (this.generation === generation) {
          this.inflightKey = null
          this.inflightPromise = null
        }
      })

    this.inflightPromise = promise
    return generation
  }

  cancel(): void {
    this.signal.aborted = true
    this.generation += 1
    this.signal = { generation: this.generation, aborted: true }
    this.prepared = null
    this.inflightKey = null
    this.inflightPromise = null
  }

  flush(): Promise<void> {
    return this.inflightPromise ?? Promise.resolve()
  }

  /** Есть незавершённый prepareContinuation. */
  isBusy(): boolean {
    return this.inflightPromise !== null
  }
}

/** Пустой порт: кандидатов нет, поиск по исполнителю не вызывается. */
export const emptyContinuationProvider: ContinuationProvider = {
  prepareContinuation() {
    return Promise.resolve(null)
  },
}

let session: ContinuationSession | null = null

export function getContinuationSession(): ContinuationSession {
  if (!session) {
    session = new ContinuationSession()
  }
  return session
}

export function resetContinuationSessionForTests(): void {
  session?.cancel()
  session = new ContinuationSession()
}
