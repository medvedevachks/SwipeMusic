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

Доменные сущности живут в `src/types/` (Track, Category, Collection, SwipeAction, MusicSource, Rule, History).

- **Swipe Engine** (`src/services/swipeEngine`) — направление жеста → семантическое действие. UI только отображает результат.
- **Music Sources** (`src/sources`) — единый `MusicSourceAdapter`; `MusicSourceRegistry` поддерживает несколько активных источников одновременно.
- **Store** (`src/store`) — коллекция, категории, история действий. Без бизнес-логики жестов в компонентах.

Правила (`Rule`) пока только как модель — логика автокатегоризации будет позже.
