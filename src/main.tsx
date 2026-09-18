import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { restoreSession } from './services/sync/collectionSync'
import { bootstrapMusicSources } from './sources'
import './index.css'
import App from './App.tsx'

bootstrapMusicSources()
registerSW({ immediate: true })
void restoreSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
