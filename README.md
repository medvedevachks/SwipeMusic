# Swipe Music

PWA для поиска, прослушивания и категоризации музыки жестами.

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
- **Local Music** — экран `/sources`: выбор папки, пересканирование, отключение; треки участвуют в поиске, свайпах и плеере как обычный источник.
- **Library** (`src/library`) — `LibraryProvider` + `LibraryService` + дерево узлов; UI не знает Spotify/Local/Zaycev. Новый источник = `MusicSourceAdapter` + `LibraryProvider` (+ `registerPlugin`).
- **Collection Engine** (`src/services/collectionEngine`) — пользовательская база Track-снимков + статистика, независимо от источников.
- **Audio Player** (`src/services/audioPlayer`) — `PlayerAdapter` → `AudioPlayer` → `playerStore`. UI на Home: свайп-карточка + `PlaybackControls`, отдельного экрана Player нет.
- **Store** (`src/store`) — коллекция, категории, история, плеер и список источников.

Правила (`Rule`) пока только как модель — логика автокатегоризации будет позже.

Экран источников: `/sources` (ссылка из Профиля).
