export type PlatformEventMap = {
  TrackStarted: { trackId: string; sourceId: string }
  TrackFinished: { trackId: string; sourceId: string }
  LibraryUpdated: { sourceId: string }
  SourceEnabled: { sourceId: string }
  SourceDisabled: { sourceId: string }
  DownloadFinished: { trackId: string; sourceId: string }
  MetadataUpdated: { trackId: string; sourceId: string }
  PluginRegistered: { pluginId: string }
}

export type PlatformEventName = keyof PlatformEventMap

type Handler<T> = (payload: T) => void

/**
 * Шина событий между плагинами и ядром.
 * Прямых вызовов между плагинами быть не должно.
 */
export class EventBus {
  private readonly listeners = new Map<
    PlatformEventName,
    Set<Handler<unknown>>
  >()

  on<K extends PlatformEventName>(
    event: K,
    handler: Handler<PlatformEventMap[K]>,
  ): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(handler as Handler<unknown>)
    this.listeners.set(event, set)
    return () => {
      set.delete(handler as Handler<unknown>)
    }
  }

  emit<K extends PlatformEventName>(
    event: K,
    payload: PlatformEventMap[K],
  ): void {
    const set = this.listeners.get(event)
    if (!set) {
      return
    }
    for (const handler of set) {
      handler(payload)
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}

export const platformEventBus = new EventBus()
