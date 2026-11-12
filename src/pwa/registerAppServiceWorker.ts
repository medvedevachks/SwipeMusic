import { registerSW } from 'virtual:pwa-register'
import {
  SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS,
  handleServiceWorkerNeedReload,
  isAudibleHtmlAudioPlaying,
} from './serviceWorkerUpdatePolicy.ts'

/**
 * Регистрация SW приложения.
 * - immediate + periodic update(): не ждать 24h браузерного интервала
 * - onNeedReload: не перезагружать вкладку, пока играет audio
 * - skipWaiting/clientsClaim задаются в vite.config workbox (из‑за injectRegister:false)
 */
export function registerAppServiceWorker(): (reloadPage?: boolean) => Promise<void> {
  return registerSW({
    immediate: true,
    onNeedReload() {
      handleServiceWorkerNeedReload({
        isPlaying: () => isAudibleHtmlAudioPlaying(),
        reload: () => {
          window.location.reload()
        },
      })
    },
    onRegisteredSW(_url, registration) {
      void registration?.update()
      if (!registration || typeof window === 'undefined') return

      window.setInterval(() => {
        void registration.update()
      }, SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS)
    },
  })
}
