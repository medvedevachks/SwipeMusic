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
- **Music Sources** (`src/sources`) — `SourceType`: api | scraper | filesystem; `ApiMusicAdapter` / `ScraperMusicAdapter` (+ `HtmlFetcher` browser|backend) / `FileSystemMusicAdapter`; регистрация одной строкой: `registerMusicSource(new MyAdapter())`.
- **Collection Engine** (`src/services/collectionEngine`) — пользовательская база Track-снимков + статистика, независимо от источников.
- **Audio Player** (`src/services/audioPlayer`) — `PlayerAdapter` → `AudioPlayer` → `playerStore`. UI не трогает `HTMLAudioElement`.
- **Store** (`src/store`) — коллекция, категории, история, плеер и список источников.

Правила (`Rule`) пока только как модель — логика автокатегоризации будет позже.

Экран источников: `/sources` (ссылка из Профиля).
