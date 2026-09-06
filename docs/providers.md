# Provider Plugin SDK

SwipeMusic использует **plugin-first** архитектуру: новый источник музыки
подключается без изменений UI, Swipe, Search, Player и Library.

```
ProviderPlugin
├── MusicSourceAdapter   (обязательно)
├── LibraryProvider      (рекомендуется)
├── SearchProvider       (опционально)
├── MetadataProvider     (опционально)
├── ArtworkProvider      (опционально)
├── AuthenticationProvider (опционально)
└── Downloader           (опционально)
```

## Быстрый старт

```ts
import { registerPlugin } from '../src/sdk'
import { myProviderPlugin } from '../providers/MyProvider'

registerPlugin(myProviderPlugin)
```

Одна строка. UI подхватит capabilities из `ProviderManifest`.

## Обязательные части

| Контракт | Зачем |
|----------|--------|
| `ProviderManifest` | id, name, version, capabilities |
| `createMusicSourceAdapter` | лента / поиск / stream |

## Опциональные части

| Контракт | Когда нужен |
|----------|-------------|
| `createLibraryProvider` | дерево в `/library` |
| `createSearchProvider` | отдельный search API |
| `createMetadataProvider` | обогащение метаданных |
| `createArtworkProvider` | обложки |
| `createAuthenticationProvider` | OAuth / login |
| `createDownloader` | скачивание треков |

## Capabilities

UI **не** проверяет `if (spotify)`. Только capabilities:

```ts
capabilities: {
  search: true,
  library: true,
  streaming: true,
  download: false,
  artwork: true,
  authentication: true,
  lyrics: false,
}
```

Примеры:

- `download: false` → скрыть Download
- `library: false` → не показывать раздел Library для источника
- `lyrics: false` → скрыть вкладку Lyrics

## ProviderContext

Каждый factory получает контекст:

```ts
ctx.logger.info('hello')
await ctx.http.getJson('/api/tracks')
await ctx.cache.set('key', data, { ttlMs: 60_000 })
await ctx.storage.setJson('token', token)
ctx.eventBus.emit('LibraryUpdated', { sourceId: ctx.pluginId })
```

Не создавайте свой fetch/cache с нуля — используйте SDK.

## HttpClient

```ts
const data = await ctx.http.getJson<MyDto>('/v1/search', {
  headers: { Authorization: 'Bearer …' },
  timeoutMs: 10_000,
  retries: 2,
  cacheKey: `search:${query}`,
  cacheTtlMs: 30_000,
  signal: ctx.signal,
})
```

Поддержано: timeout, retry, headers, cookies (`credentials: include`),
AbortController, простой rate-limit, cache. Proxy — reserved.

## Cache

- `MemoryCacheProvider` — по умолчанию в контексте
- `IndexedDbCacheProvider` — `createProviderContext(id, { cacheMode: 'indexeddb' })`

## EventBus

События: `TrackStarted`, `TrackFinished`, `LibraryUpdated`,
`SourceEnabled`, `SourceDisabled`, `DownloadFinished`, `MetadataUpdated`,
`PluginRegistered`.

Плагины общаются только через EventBus, не напрямую.

## Шаблон

Скопируйте [`providers/_template`](../providers/_template):

```
providers/MyProvider/
  manifest.ts
  index.ts
  MusicSourceAdapter.ts
  LibraryProvider.ts
  SearchProvider.ts   (опционально)
```

## Регистрация встроенных

Встроенные источники (Demo, Spotify, Local Music, …) регистрируются через
`bootstrapProviderPlugins()` при `bootstrapMusicSources()`.

`registerMusicSource(adapter)` остаётся совместимым API и внутри
создаёт `ProviderPlugin`.

## Иконка и настройки

- `manifest.icon` — строковый ключ иконки для UI
- `ctx.settings` / `ctx.storage` — настройки плагина (persist через storage)

## Что не нужно менять

SwipeEngine · Player · SearchEngine · Library UI · AudioPlayer · Collection · Track

Новый источник = новая папка + `registerPlugin(...)`.
