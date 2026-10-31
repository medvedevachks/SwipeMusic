/**
 * Политика обновления PWA без сброса localStorage/сессий и без обрыва музыки.
 *
 * registerType autoUpdate + injectRegister:false раньше НЕ включали
 * workbox.skipWaiting/clientsClaim → новый SW зависал в waiting, а обычный
 * Reload продолжал получать precache index.html от старого контроллера.
 */

export const SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Нужен ли немедленный reload после активации нового SW. */
export function shouldReloadForServiceWorkerUpdate(isPlaying: boolean): boolean {
  return !isPlaying
}

/**
 * Есть ли сейчас слышимое HTMLAudio воспроизведение.
 * Не трогает AudioPlayer API — только DOM, чтобы не тащить плеер в bootstrap.
 */
type AudioLike = {
  tagName?: string
  paused?: boolean
  ended?: boolean
}

export function isAudibleHtmlAudioPlaying(
  doc: { querySelectorAll: (selectors: string) => { length: number; item: (index: number) => unknown } } | null | undefined =
    typeof document !== 'undefined' ? document : undefined,
): boolean {
  if (!doc) return false
  const nodes = doc.querySelectorAll('audio')
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes.item(i) as AudioLike | null
    if (!el) continue
    if (el.tagName && el.tagName !== 'AUDIO') continue
    if (typeof el.paused !== 'boolean' || typeof el.ended !== 'boolean') continue
    if (!el.paused && !el.ended) return true
  }
  return false
}

export type ServiceWorkerUpdateHooks = {
  isPlaying: () => boolean
  reload: () => void
}

/** Вызов из onNeedReload / activated(isUpdate): reload только если музыка не играет. */
export function handleServiceWorkerNeedReload(hooks: ServiceWorkerUpdateHooks): void {
  if (!shouldReloadForServiceWorkerUpdate(hooks.isPlaying())) return
  hooks.reload()
}
