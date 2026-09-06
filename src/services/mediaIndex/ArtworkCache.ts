/**
 * Кэш ключей обложек (не blob URL).
 * UI резолвит URL через ArtworkProvider / getCover адаптера.
 */
export class ArtworkCache {
  private readonly keys = new Map<string, string>()

  set(trackId: string, artworkKey: string): void {
    this.keys.set(trackId, artworkKey)
  }

  get(trackId: string): string | null {
    return this.keys.get(trackId) ?? null
  }

  remove(trackId: string): void {
    this.keys.delete(trackId)
  }

  clear(): void {
    this.keys.clear()
  }
}

export const artworkCache = new ArtworkCache()
