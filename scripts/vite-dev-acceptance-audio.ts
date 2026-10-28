/**
 * Отдаёт WAV только в Vite DEV при VITE_DEV_ACCEPTANCE=true.
 * Файлы лежат в .data/ (не в public/) — не попадают в production dist.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import type { Plugin } from 'vite'

const AUDIO_ROOT = resolve('.data/dev-acceptance/audio')

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.wav':
      return 'audio/wav'
    case '.mp3':
      return 'audio/mpeg'
    default:
      return 'application/octet-stream'
  }
}

export function devAcceptanceAudioPlugin(): Plugin {
  return {
    name: 'dev-acceptance-audio',
    configureServer(server) {
      if (process.env.VITE_DEV_ACCEPTANCE !== 'true') {
        return
      }
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/dev-acceptance/')) {
          next()
          return
        }
        const relative = decodeURIComponent(url.slice('/dev-acceptance/'.length).split('?')[0] ?? '')
        if (!relative || relative.includes('..') || relative.includes('\\')) {
          res.statusCode = 400
          res.end('Bad path')
          return
        }
        const filePath = normalize(join(AUDIO_ROOT, relative))
        if (!filePath.startsWith(AUDIO_ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        res.setHeader('Content-Type', contentType(filePath))
        res.setHeader('Cache-Control', 'no-store')
        createReadStream(filePath).pipe(res)
      })
    },
  }
}
