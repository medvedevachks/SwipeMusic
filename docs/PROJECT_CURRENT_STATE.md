# Swipe Music — актуальное состояние проекта

**Назначение документа:** единый снимок для нового Cursor-аккаунта или нового чата.
Читать **этот файл раньше**, чем `GPT.md` и `RELEASE_REPORT.md`. Исторические документы не удалять; при расхождении достовернее код, Git и этот снимок.

| Поле | Значение |
|---|---|
| Дата снимка | 2026-10-30 (UX-10 swipe UP + inbox→Home sorting) |
| Канонический репозиторий | https://github.com/medvedevachks/SwipeMusic |
| Ветка снимка | `feature/deploy-windows-01` |
| Проверенный HEAD | UX-10 локально (BUG1 UP/next + BUG2 `/library/swipes` → Home sorting); shuffle hotfix уже в ветке `3f3d27e`. Production S1 — без deploy по этой задаче. |
| Исторический upstream | https://github.com/r-sh-galimov/SwipeMusic |

**Легенда источников фактов**

- **Код / Git** — проверено в репозитории на HEAD снимка.
- **Отчёт** — операторский / предыдущий release-отчёт; с DEV-ПК не перепроверялось.
- **План** — не реализовано или не завершено.

---

## 1. Продукт

Swipe Music — Progressive Web App: личная музыкальная библиотека, swipe-категоризация, поиск по подключённым источникам, единый плеер. Приложение **не** заменяет стриминговые сервисы и не обходит их доступ/подписки.

Стек (**код**): React 19, TypeScript, Vite 8, Tailwind 4, Zustand, React Router, `vite-plugin-pwa`, Node backend (`node:http`, `node:sqlite`).

---

## 2. Архитектура воспроизведения

```text
UI (pages / BottomPlayer)
  → PlaybackIntent
  → PlaybackQueue + PlaybackContext
  → AudioPlayer.playTrack
  → (опционально) runtime fallback по SourceCopy
  → PlaybackResolver
  → MusicSourceAdapter / PlayerAdapter
  → HTMLAudioElement или Spotify Web Playback SDK
```

| Слой | Роль | Ключевые файлы |
|---|---|---|
| Intent | Старт из поиска, свайпа, альбома, волны | `src/services/playbackIntent/PlaybackIntent.ts` |
| Очередь | Единственная очередь, shuffle/repeat, persist | `src/services/playbackQueue/PlaybackQueue.ts` |
| Контекст | Provenance очереди (`album`, `playlist`, `swipe`, `search`, `search-seed`, …) | `src/types/playbackContext.ts` |
| Плеер | Единственный движок воспроизведения | `src/services/audioPlayer/AudioPlayer.ts` |
| UI плеера | Постоянный нижний бар, не второй плеер | `src/components/player/BottomPlayer.tsx`, `src/store/playerStore.ts`, `src/layouts/MainLayout.tsx` |
| Resolver | URL / candidates через адаптер | `src/services/playbackResolver/PlaybackResolver.ts` |
| Адаптеры | HTML / Spotify | `src/services/audioPlayer/HtmlAudioPlayerAdapter.ts`, `SpotifyPlayerAdapter.ts`, `PlayerManager.ts` |

**Ограничение:** не создавать второй GlobalPlayer и не заводить конкурирующую очередь.

---

## 3. Canonical Track → SourceCopies → Playback

| Понятие | Смысл | Файлы |
|---|---|---|
| Source Track / SourceCopy | Идентичность провайдера: обычно `${sourceId}:${externalId}` | `src/types/canonical.ts`, `src/types/track.ts` |
| Canonical Track | Организация пользователя (лайк, каталоги), id `can_…` | `src/types/canonical.ts`, server `user_canonical_*` |
| Availability | Runtime-доказательство PLAYABLE, не часть identity | `src/types/playbackAvailability.ts`, `src/services/playbackAvailability/` |
| Playable selection | Выбор одной PLAYABLE copy **до** старта | `src/services/playbackAvailability/` |
| Runtime fallback | После ошибки — следующая известная copy той же композиции; очередь не двигается | `src/services/runtimeFallback/` |

Склейка поиска и дедуп свайп-ленты по canonical **не** сделаны (**код** / roadmap). Discovery-провайдеры в production-реестре пусты.

---

## 4. Источники музыки

Реестр и менеджер: `src/sources/SourceManager.ts`, `src/sources/registry.ts`.

| Источник | Статус на HEAD | Файлы |
|---|---|---|
| `mock` | Демо; исключается из «реальной» библиотеки / continuation | `src/sources/adapters/mock/`, `src/sources/demoSource.ts` |
| `yandex-music` | Experimental Device Flow; сессия на backend; **не переписывать** без отдельного решения | `src/sources/adapters/yandex-music/`, `server/providers/` |
| `local-folder` | File System Access + IndexedDB handle | `src/sources/adapters/local-folder/` |
| `spotify` | OAuth PKCE, SDK; нужен `VITE_SPOTIFY_CLIENT_ID` | `src/sources/adapters/spotify/` |
| `vk-music`, `zaycev`, custom | Заготовки | соответствующие `adapters/` |

Поиск: единый UI `/search` через активные адаптеры (`src/pages/Search.tsx` и search-слой источников).

---

## 5. Авторизация и хранение

| Данные | Где | Файлы |
|---|---|---|
| Аккаунт Swipe Music | SQLite + HttpOnly cookie `sm_session` | `server/http/authRoutes.ts`, `server/auth/` |
| Библиотека пользователя | SQLite `/api/me/*`, владелец только из сессии | `server/http/libraryRoutes.ts`, `server/library/` |
| Yandex provider session | Сервер, ключ шифрования вне Git (`.data` / `secrets` на машине) | `server/providers/`, клиент `sessionClient.ts` / `reconcileSession.ts` |
| Очередь | `localStorage` | `PlaybackQueue.ts` |
| MediaIndex / local handles | IndexedDB | `src/services/mediaIndex/` |
| Тема | `localStorage` `swipe-music.theme` | `src/theme/` |

Секреты, `.env`, production SQLite и `provider-session.key` **не** коммитить. Пути `.data/`, `/data/`, `/secrets/` в `.gitignore`.

---

## 6. Аналитика прослушиваний

Клиент шлёт события из плеера; сервер хранит статистику пользователя.

- Клиент: `src/services/playbackAnalytics/` (`report.ts`, `runtime.ts`, …), вызовы из `AudioPlayer.ts`.
- Сервер: `server/library/playback/`.

Аналитика не меняет очередь и не подменяет источник.

---

## 7. UserTasteProfile

Приватный профиль вкуса из сигналов пользователя (лайки, прослушивания и т.д.).

| Часть | Файлы |
|---|---|
| Модель / расчёт | `src/services/taste/types.ts`, `buildTasteProfile.ts`, `weights.ts` |
| Клиентская загрузка | `src/services/taste/loadSessionTasteProfile.ts` — только при включённом search-seed; поколение + владелец сессии; timeout |
| Привязка сессии | `src/store/authStore.ts` → `bindSessionTasteUser` |
| API | `GET /api/me/taste-profile` в `server/http/libraryRoutes.ts` |
| Ограничения ответа | `server/library/taste/presentTasteProfile.ts` (cap 500 tracks), rate limit в `server/auth/rateLimit.ts` |

`userId` из query/body **игнорируется**; гость → 401. Токены и stream URL в ответе не отдаются.

---

## 8. Recommendation Engine (единый runtime)

Единый API: `src/services/recommendation` → `recommendNext` + session/advance.

| Часть | Файлы |
|---|---|
| Ядро | `engine.ts`, `types.ts`, `identity.ts` |
| Continuation bridge | `continuationBridge.ts` → `ContinuationProvider` |
| Session | `sessionRuntime.ts`, `sessionState.ts` — mode `search` \| `swipe` \| `wave` |
| Advance | `advance.ts` → `consumeRecommendationAdvance` / `resolveRecommendationAdvance`; очередь через `enqueueRecommendationAdvance` |
| AudioPlayer | `playRecommendationAdvance` (Next / ended); сериализация быстрых Next |

- Режимы `swipe` | `wave`: одинаковая стратегия (`sameRecommendationStrategy`).
- Search-seed: тот же advance; `ensureSearchRecommendation` ставит provider + mode `search`.
- Swipe cold start: `Home` → `pickRecommendationStart` + `commitRecommendationSeed` (**без** autoplay).
- Wave: `myWaveRuntime.toggleLiveMyWave` → тот же pick/commit (`mode: 'wave'`); `buildPersonalRadio` на живом пути **не** вызывается (код в `recommend.ts` / `toggleMyWave.ts` сохранён).
- Лента карточек Home **не** дампится в `PlaybackQueue` (`allowFeedAsQueue: false`).
- **HOME-CARD-SYNC:** `resolveHomeDeckTracks` — browse feed vs playback-колода из очереди плеера; `SwipeDeck.advanceAtEnd` для Next на последней карточке. Search hits не переписываются рекомендациями.
- **Exhausted:** miss → `markRecommendationExhausted`, last track сохраняется (без `queueIndex=-1`); UI «Рекомендации закончились», Next не подставляет search hits.
- **DEV acceptance:** источник `dev-acceptance` только при `import.meta.env.DEV && VITE_DEV_ACCEPTANCE=true`; WAV в `.data/dev-acceptance/audio` через Vite middleware (не `public/`, не в dist). Backend DEV: `DATABASE_PATH=.data/dev-acceptance/swipemusic.sqlite` (не `dev-owner` / default). `scripts/dev-acceptance-prepare.mts` сохраняет `PASSWORD.txt`+hash при повторном запуске (`--rotate-password` для смены); пароль только ASCII alnum, файл **без** trailing newline (иначе Ctrl+A → 401). Серверная login-диагностика (`dev-login-diag` / `X-Swipe-Dev-Auth`) удалена (RELEASE-CLEANUP-16).
- **Recommendation Engine:** `seedArtists` — liked/taste раньше current; ранжирование штрафует same-artist dump. DEV-каталог: выдача «Сплин» (5) + другие исполнители; prepare сидит сильные лайки Кино/Земфира/Би-2/…
- **Search hard-exclude:** при `search-seed` вся исходная выдача → `context.hardExcludeHits` (persist в queue); Next/ended/gesture не берут эти треки; swipe/wave/album не наследуют.
- Album / playlist: последовательный `queue.next`, не recommendation advance.
- Пустой вкус / нет источников → miss (`emptyReason`), не «персонализированный» hit.
- DEV-диагностика search-flow сохранена.

Интеграционные тесты: `recommendation.integration.test.ts` (A–I), `searchRecommendation.integration.test.ts`.

## 8b. «Моя волна» (legacy)

`buildPersonalRadio` / `toggleMyWave` остаются в дереве для unit-тестов Personal Radio; UI и live runtime идут через Recommendation Engine (§8).

Известная проблема качества (**план**, RADIO-08): повторы и нерелевантные треки — **не исправлено** на уровне ранжирования ядра.

---

## 9. search-seed и автопродолжение

| Тема | Состояние | Файлы |
|---|---|---|
| Флаг | DEV: включён. Production: только если build-time `VITE_SEARCH_SEED_PLAYBACK` === точная строка `true` | `src/services/continuation/searchSeedPlayback.ts`, `src/vite-env.d.ts`, `.env.example` |
| Поведение ON | Очередь = один выбранный трек; дальше кандидаты из канонической библиотеки | `commitSearchSeedQueue`, `libraryContinuation.ts`, `ContinuationSession.ts`, `searchContinuationRuntime.ts` |
| Поведение OFF | Очередь = список результатов поиска (legacy) | `planSearchPlayback` |
| UI | Search / Home search-deck | `src/pages/Search.tsx`, `src/pages/Home.tsx` |
| Advance | `AudioPlayer` next/ended → `playRecommendationAdvance` → `resolveRecommendationAdvance` (search-seed ⊂ recommendation) | `AudioPlayer.ts`, `recommendation/advance.ts`; `consumeSearchSeedAdvance` — тонкая обёртка |
| Queue provenance | Persist/restore пишет `sessionTailIds`. Legacy search-seed без поля: хвост hits срезается до current (не объявлять dump рекомендацией). Album/playlist/swipe/radio без поля — полный список | `PlaybackQueue.ts` |

**Команды сборки**

```text
# OFF (штатный production-путь)
npm run build

# ON (только после явного решения этапа 3)
# PowerShell: $env:VITE_SEARCH_SEED_PLAYBACK='true'; npm run build
# затем снять переменную из окружения
```

На **установленном** production (см. §11) search-seed пока **OFF** (**отчёт**). Коммит `3dc112d` готовит флаг, но на сервер ещё не выкатывался (**отчёт**).

Last.fm и MusicBrainz для рекомендаций **не** подключать.

---

## 10. Media Session и Android PWA

| Тема | Состояние | Файлы |
|---|---|---|
| Media Session | Код есть: pause/resume/next/previous → тот же AudioPlayer | `src/services/audioPlayer/mediaSession.ts` |
| Физические кнопки руля | **Не проверены** (**отчёт** / план MEDIA-REMOTE-02) | — |
| PWA | `vite-plugin-pwa`, `registerType: 'autoUpdate'` | `vite.config.ts`, `index.html` |

Не объявлять успех руля без журнала с магнитолы.

---

## 11. Git (DEV) и Production

### 11.1 Наблюдаемо на DEV / GitHub (**код / Git**)

- Remote `origin`: `medvedevachks/SwipeMusic`.
- Ветка: `feature/deploy-windows-01`.
- Код: Recommendation Engine + HOME-CARD-SYNC + SEARCH-EXCLUSION (`hardExcludeHits`) + PLAYBACK-HISTORY (`historyIndex`) + DEV acceptance (только `DEV && VITE_DEV_ACCEPTANCE`).
- Production build для выкладки: **`VITE_SEARCH_SEED_PLAYBACK=true`** (без флага search-seed OFF).
- DEV-ПК `KOMPUTER`: путь `C:\SwipeMusic` **недоступен** → frontend deploy на S1 только с консоли Server.

### 11.2 Production (**отчёт + probe с KOMPUTER**)

| Параметр | Значение |
|---|---|
| ОС | Windows Server 2019 (S1) |
| Каталог | `C:\SwipeMusic` |
| Публичный URL | `https://app.swipe-music.site:8443` |
| Backend | `127.0.0.1:8787` за Caddy |
| Установленный код (до RELEASE-13) | `b403874` (**отчёт** владельца); search-seed OFF |
| HTTPS / health (probe KOMPUTER) | 200 / `{"ok":true}` |
| SQLite / secrets | вне Git; frontend-only релиз **не** трогает |
| start-backend.ps1 preferredNode | локальная правка S1 — **не** перезаписывать |

Не путать: успешный `/api/health` ≠ новый frontend установлен.

---

## 12. Незавершённые задачи (не считать DONE)

| Приоритет | Задача | Суть |
|---|---|---|
| **1** | UX-10 review → commit/push | BUG1 (UP/next + like semantics) и BUG2 (Play inbox → Home sorting, categorize без обрыва звука) готовы локально. Push/deploy только по отдельному разрешению. |
| **2** | LIBRARY-UX / S1 deploy | Inbox + compact `/library` на ветке; production deploy только после PASS review. **S1 не трогать** без задачи. |
| **3** | RELEASE / S1 sync | Frontend deploy на S1 только с Server. **Без** restart backend/Caddy/AD без задачи. |
| **4** | RADIO-08 | Убрать нерелевантные и повторяющиеся треки волны/свайпов на уровне ранжирования ядра. |
| **5** | MEDIA-REMOTE-02 | Проверить физические кнопки руля на Android-магнитоле. |

Не начинать RADIO-08 до закрытия пользовательской проверки RELEASE-13. Car Mode / VK / Zaycev — только по отдельному решению.

---

## 13. Роли и жёсткие ограничения

1. Пользователь задаёт приоритеты.
2. ChatGPT — главный архитектор.
3. Cursor — исполнитель по согласованной задаче.
4. Не переписывать рабочий Yandex flow без отдельного решения.
5. Не подключать Last.fm / MusicBrainz для рекомендаций.
6. Не создавать второй GlobalPlayer / вторую очередь.
7. Не обходить лицензии сервисов.
8. Не терять незакоммиченные изменения; не `force push` / `reset --hard` / `clean` без явного разрешения.
9. Не публиковать секреты, токены, cookies, содержимое SQLite.
10. Не менять production без согласованной задачи; не удалять user SQLite и secrets.
11. Не включать experimental-функции без явного решения (search-seed = build-flag).
12. После реализации — проверяемый отчёт: SHA, тесты/lint/build, ограничения, что не проверено.

Инструкции агента: `AGENTS.md`, `.cursor/rules/swipe-music.mdc`. Продуктовое определение MVP: `docs/MVP_V1.md`. Статус этапов MVP (может отставать от release-фокуса): `docs/ROADMAP_MVP_V1.md`.

---

## 14. Что сознательно не является источником истины

| Документ | Почему осторожно |
|---|---|
| `GPT.md` | Снимок более раннего кода: нет search-seed / Media Session / backend Yandex session; устаревшие счётчики тестов |
| `RELEASE_REPORT.md` | Фиксирует выпуск вокруг `14fc4cb` и старые утверждения (taste 404, search-seed всегда false, константа включения). После `3dc112d` поведение другое |
| `docs/yandex-music.md` / части `docs/providers.md` | Могут описывать stub |

При сомнении: **код на `3dc112d` → этот файл → Git log → только потом исторические md**.

---

## 15. Быстрый чеклист для нового агента

1. `git rev-parse HEAD` / `git status` — сверить с этим снимком и задачей.
2. Прочитать этот файл целиком.
3. Не деплоить на Server без задачи RELEASE и доступа к `C:\SwipeMusic` **на S1**.
4. Не считать RADIO-08, руль и «реальный Yandex PASS» закрытыми без проверки владельца.
5. Application-секреты, `.data/**`, `PASSWORD.txt` не читать в отчёты и не коммитить.
