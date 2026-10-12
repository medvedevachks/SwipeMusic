import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ServerOptions } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const lanCertPath = resolve('.certs/lan-cert.pem')
const lanKeyPath = resolve('.certs/lan-key.pem')

function readLanHttps(): ServerOptions['https'] {
  if (!existsSync(lanCertPath) || !existsSync(lanKeyPath)) {
    const message = [
      'LAN HTTPS: не найдены локальные сертификаты.',
      '',
      'Ожидаются файлы:',
      '  .certs/lan-cert.pem',
      '  .certs/lan-key.pem',
      '',
      'npm run dev их не требует и остаётся на http://127.0.0.1:5173.',
      'Для Android PWA в локальной сети:',
      '  1. Посмотрите IPv4 через ipconfig и выберите IP своей Wi-Fi или Ethernet сети.',
      '  2. powershell -ExecutionPolicy Bypass -File .\\scripts\\setup-lan-pwa.ps1 -LanIp <IP>',
      '',
      'Если mkcert не установлен, скрипт остановится и покажет:',
      '  winget install FiloSottile.mkcert',
    ].join('\n')
    console.error(`\n${message}\n`)
    throw new Error(
      'LAN HTTPS certificates are missing. Run scripts/setup-lan-pwa.ps1 -LanIp <IP>.',
    )
  }

  return {
    cert: readFileSync(lanCertPath),
    key: readFileSync(lanKeyPath),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Swipe Music',
        short_name: 'SwipeMusic',
        description: 'PWA for searching, listening to, and organizing music',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'ru',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith('/api/auth/') ||
              url.pathname.startsWith('/api/me/') ||
              url.pathname.startsWith('/api/yandex-music') ||
              url.pathname.startsWith('/api/yandex-oauth') ||
              url.pathname === '/api/yandex-fetch',
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: mode === 'lan' ? '0.0.0.0' : '127.0.0.1',
    port: 5173,
    https: mode === 'lan' ? readLanHttps() : undefined,
    proxy: {
      '/api/auth': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/api/me': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/api/yandex-music': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/api/yandex-oauth': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/api/yandex-fetch': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
}))
