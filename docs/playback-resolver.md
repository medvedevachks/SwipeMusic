# PlaybackResolver

Централизованный выбор способа воспроизведения.

```
Track → PlaybackResolver → PlaybackCandidate → PlayerAdapter
```

Player / Queue / Library / Search / UI **не** решают Premium / preview / Local.

## PlaybackCandidate

```ts
{
  id: 'spotify:preview',
  providerId: 'spotify',
  type: 'local' | 'stream' | 'preview' | 'remote',
  priority: number,
  available: boolean,
  url?: string,
  label?: string,
  requiresPremium?: boolean,
  reason?: string,
}
```

Каждый `MusicSourceAdapter` может реализовать `getPlaybackCandidates(track)`.
Без метода Resolver строит fallback через `getStream`.

## Приоритет (настраивается)

1. `local` (Local Files)
2. `remote` (Plex / Jellyfin / NAS)
3. `stream` (полный стрим, в т.ч. Spotify Web Playback)
4. `preview` (30s и аналоги)

`setConfig({ typePriority, providerBoost })`.

## Spotify без Premium

- `stream` → `available: false`
- `preview` → если есть `preview_url`
- иначе сообщение: «Полная версия трека недоступна. Для Spotify требуется Premium.»

Preview играет через `LocalPlayerAdapter` (обычный https URL).
Полный стрим — `spotify:` URI → `SpotifyPlayerAdapter`.

## UI

Бейдж `PlaybackModeBadge` при `type === 'preview'` (без `if (spotify)`).

## Dev

На `/sources` в development: панель принудительного выбора кандидата.
