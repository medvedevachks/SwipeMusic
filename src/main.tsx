import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { bootstrapMusicSources } from './sources'
import { applyStoredTheme } from './theme/theme.ts'
import './index.css'
import App from './App.tsx'

applyStoredTheme()
bootstrapMusicSources()
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
