/**
 * Кэш ObjectURL для локальных файлов.
 * Один URL на externalId; revoke при очистке библиотеки.
 */
export class ObjectUrlCache {
  private readonly urls = new Map<string, string>()

  get(externalId: string): string | undefined {
    return this.urls.get(externalId)
  }

  set(externalId: string, url: string): string {
    const previous = this.urls.get(externalId)
    if (previous && previous !== url) {
      URL.revokeObjectURL(previous)
    }
    this.urls.set(externalId, url)
    return url
  }

  has(externalId: string): boolean {
    return this.urls.has(externalId)
  }

  revoke(externalId: string): void {
    const url = this.urls.get(externalId)
    if (!url) {
      return
    }
    URL.revokeObjectURL(url)
    this.urls.delete(externalId)
  }

  clear(): void {
    for (const url of this.urls.values()) {
      URL.revokeObjectURL(url)
    }
    this.urls.clear()
  }

  size(): number {
    return this.urls.size
  }
}
