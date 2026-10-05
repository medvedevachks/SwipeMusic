# Swipe Music

Универсальный музыкальный организатор. Он собирает треки из нескольких источников в одну библиотеку и в пользовательские каталоги.

Канонический репозиторий: https://github.com/medvedevachks/SwipeMusic

Исторический upstream: https://github.com/r-sh-galimov/SwipeMusic

## Статус

MVP-01, MVP-02, MVP-03, MVP-04, MVP-05 и MVP-06 сделаны.

Приоритет сейчас — Car MVP: локальная музыка, playback каталогов, очередь, Car Mode, deployment, PWA на Android head unit и automotive QA. VK и Zaycev подключаются только после отдельного архитектурного решения.

Yandex stabilization отложена. Текущая интеграция Яндекс Музыки заморожена как рабочий baseline Car MVP и не переписывается без отдельного решения.

Защищённый baseline: commit `888f5e2`, ветка `checkpoint/car-mvp-foundation`, tag `car-mvp-foundation`.

## Источники

- Яндекс Музыка: экспериментальная интеграция уже есть. Для Car MVP она заморожена.
- Локальные файлы: реализованы.
- Spotify: реализация есть. Это не текущий приоритет Car MVP.
- VK Музыка: заготовка, воспроизведение не поддерживается.
- Zaycev: заготовка, воспроизведение не поддерживается.
- Custom: заготовка, воспроизведение не поддерживается.

## Стек

- React + TypeScript + Vite
- Tailwind CSS
- React Router
- vite-plugin-pwa
- Zustand

## Запуск

```bash
npm install
npm run dev
```

Сборка:

```bash
npm run build
npm run preview
```

## Архитектура

Доменные сущности живут в `src/types/` (Track, Category, Collection, SwipeAction, MusicSource, Rule, History, PlayerState).

- **Swipe Engine** (`src/services/swipeEngine`) — направление жеста → семантическое действие. UI только отображает результат.
- **Search Engine** (`src/services/searchEngine`) — запрос → активные адаптеры через SourceManager → merge/dedupe → Track[].
- **Music Sources** (`src/sources`) — `SourceType`: api | scraper | filesystem; адаптеры + `registerMusicSource(...)`.
- **Provider Plugin SDK** (`src/sdk`) — plugin-first: `ProviderManifest` + `registerPlugin(...)`; HttpClient, Cache, EventBus, ProviderContext. См. [docs/providers.md](docs/providers.md).
- **Media Index** (`src/services/mediaIndex`) — единая БД библиотеки: sync из Provider → upsert; Library/Search читают только индекс. См. [docs/media-index.md](docs/media-index.md).
- **Local Music** — экран `/sources`: выбор папки, пересканирование, отключение; треки участвуют в поиске, свайпах и плеере как обычный источник.
- **Spotify** — полноценный Provider (OAuth PKCE, library sync → MediaIndex, search, preview stream). Настройка: `VITE_SPOTIFY_CLIENT_ID` в `.env` (см. `.env.example`). Подключение на `/sources`.
- **Library** (`src/library`) — `LibraryProvider` + `LibraryService` + дерево узлов; UI не знает Spotify/Local/Zaycev. Новый источник = `MusicSourceAdapter` + `LibraryProvider` (+ `registerPlugin`).
- **Collection Engine** (`src/services/collectionEngine`) — пользовательская база Track-снимков + статистика, независимо от источников.
- **Audio Player** (`src/services/audioPlayer`) — `PlayerAdapter` → `AudioPlayer` → `playerStore` / `useGlobalPlayerStore`. Порядок — `PlaybackQueue`. Единый singleton Audio.
- **Global Bottom Player** (`src/components/player/BottomPlayer.tsx`) — persistent панель в `MainLayout` (вне маршрутов): seek/drag, volume/mute, repeat/shuffle, rate, hotkeys. Навигация не останавливает воспроизведение.
- **Playback Queue** (`src/services/playbackQueue`) — единственный порядок воспроизведения; Repeat/Shuffle; persist; UI `/queue`.
- **PlayerManager** (`src/services/audioPlayer`) — маршрутизация `LocalPlayerAdapter` / `SpotifyPlayerAdapter` (Web Playback SDK) по `sourceId` / URI; UI не знает провайдера.
- **PlaybackResolver** (`src/services/playbackResolver`) — выбор лучшего `PlaybackCandidate` (local / stream / preview); Player получает только URL. См. [docs/playback-resolver.md](docs/playback-resolver.md).
- **Store** (`src/store`) — коллекция, категории, история, плеер и список источников.

Правила (`Rule`) пока только как модель — логика автокатегоризации будет позже.

Монетизация — организация библиотеки, не продажа музыки: подписка, разовая локальная покупка, рабочие места. См. [docs/monetization.md](docs/monetization.md).

Экран источников: `/sources` (ссылка из Профиля).
