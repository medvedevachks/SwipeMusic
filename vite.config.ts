import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin, ServerOptions } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * DEV-only: прокси произвольного HTTPS URL (download-info CDN Яндекса).
 * GET /api/yandex-fetch?url=https://...
 */
function yandexFetchProxy(): Plugin {
  return {
    name: 'yandex-fetch-proxy',
    configureServer(server) {
      server.middlewares.use('/api/yandex-fetch', (req, res, next) => {
        void (async () => {
          try {
            const requestUrl = new URL(req.url ?? '', 'http://127.0.0.1')
            const target = requestUrl.searchParams.get('url')
            if (!target || !/^https:\/\//i.test(target)) {
              res.statusCode = 400
              res.end('Missing https url')
              return
            }
            const upstream = await fetch(target)
            res.statusCode = upstream.status
            const contentType = upstream.headers.get('content-type')
            if (contentType) {
              res.setHeader('content-type', contentType)
            }
            const buffer = Buffer.from(await upstream.arrayBuffer())
            res.end(buffer)
          } catch (error) {
            res.statusCode = 502
            res.end(
              error instanceof Error ? error.message : 'Upstream fetch failed',
            )
          }
        })().catch(next)
      })
    },
  }
}

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
    yandexFetchProxy(),
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
              url.pathname.startsWith('/api/me/'),
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
        target: 'https://api.music.yandex.net',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/yandex-music/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // HTTP 431: браузер шлёт огромные Cookie на localhost → upstream.
            proxyReq.removeHeader('cookie')
            proxyReq.removeHeader('Cookie')
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
        },
      },
      '/api/yandex-oauth': {
        target: 'https://oauth.yandex.ru',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/yandex-oauth/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('cookie')
            proxyReq.removeHeader('Cookie')
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
        },
      },
    },
  },
}))
