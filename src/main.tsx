import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import {
  installSearchPlaybackDebugBridge,
  isSearchSeedPlaybackEnabled,
} from './services/continuation/index.ts'
import { getPlaybackQueue } from './services/playbackQueue'
import { bootstrapMusicSources } from './sources'
import { applyStoredTheme } from './theme/theme.ts'
import './index.css'
import App from './App.tsx'

applyStoredTheme()
bootstrapMusicSources()
// Штатный production не получает window.__swipeSearchDebug.
if (import.meta.env.DEV) {
  installSearchPlaybackDebugBridge(() => {
    const snapshot = getPlaybackQueue().getSnapshot()
    return {
      contextType: snapshot.context.type,
      queueLength: snapshot.items.length,
      seedPlaybackEnabled: isSearchSeedPlaybackEnabled(),
    }
  })
}
// Harness только в специальной сборке; dynamic import вырезается, если флаг ≠ true.
if (import.meta.env.VITE_SEARCH_FLOW_HARNESS === 'true') {
  void import('./services/continuation/searchFlowHarness.ts').then((module) => {
    module.installSearchFlowHarnessBridge()
  })
}
// autoUpdate: новый SW забирает клиентов; update() ловит OFF→ON без ожидания срока кэша.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    void registration?.update()
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
