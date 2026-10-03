import type { Plugin } from 'vite'
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

// https://vite.dev/config/
export default defineConfig({
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
        orientation: 'portrait',
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
              url.pathname.startsWith('/api/auth/'),
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
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api/auth': {
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
})
