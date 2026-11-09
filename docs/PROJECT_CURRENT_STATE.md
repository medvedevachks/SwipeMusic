# Swipe Music — актуальное состояние проекта

**Назначение документа:** единый снимок для нового Cursor-аккаунта или нового чата.
Читать **этот файл раньше**, чем `GPT.md` и `RELEASE_REPORT.md`. Исторические документы не удалять; при расхождении достовернее код, Git и этот снимок.

| Поле | Значение |
|---|---|
| Дата снимка | **2026-11-09** (DOCS-ARCH-01) |
| Канонический репозиторий | https://github.com/medvedevachks/SwipeMusic |
| Ветка снимка | `docs/arch-01-current-state` (от `release/nav-player-01` @ `2b7edb4`) |
| Production frontend | `2b7edb48fe73e2f7c8a514b7d7043b2569103af2` |
| Production frontend entry | `assets/index-DbM2s51K.js` |
| Production backend | `3bea5bb` |
| Production URL | https://app.swipe-music.site:8443 |
| Исторический upstream | https://github.com/r-sh-galimov/SwipeMusic |

**Легенда источников фактов**

- **Код / Git** — проверено в репозитории на SHA снимка.
- **Отчёт** — операторский / release-отчёт; с DEV-ПК не перепроверялось в этом чате.
- **Пользователь** — подтверждение владельца (сценарии UI, факт установки).
- **План** — не реализовано, не обсуждено детально или не завершено.

---

## 0. Архитектурный roadmap (согласованная последовательность)

| № | Блок | Статус |
|---|---|---|
| 1 | Музыкальный движок V2 | **DONE** — установлен и включён в production |
| 2 | Навигация и плеер | **DONE** — RELEASE-NAV-01 установлен; пользователь принял 2026-11-09 |
| 3 | Библиотека и каталоги | **NEXT** — лайки, сохранение, сортировка, скрытие, организация каталогов; **детальный UX ещё не обсуждён** |
| 4 | Поиск и альбомы | **PLANNED** |
| 5 | Аккаунт и синхронизация | **PLANNED** |

Блок 3 **не** считать специфицированным: не придумывать UX-решения до обсуждения с пользователем.

---

## 1. Продукт

Swipe Music — Progressive Web App: личная музыкальная библиотека, swipe-категоризация, поиск по подключённым источникам, единый плеер. Приложение **не** заменяет стриминговые сервисы и не обходит их доступ/подписки.

Стек (**код**): React 19, TypeScript, Vite 8, Tailwind 4, Zustand, React Router, `vite-plugin-pwa`, Node backend (`node:http`, `node:sqlite`).

---

## 2. Блок 1 — Музыкальный движок V2 (**DONE**, production)

**Статус:** завершён, установлен и **включён** в production. SessionSwitch = **true** через backend `GET /api/runtime-config` (файл `.data/session-switch.flag` / env на сервере). Production **не** включает SessionSwitch через localStorage клиента.

```text
UI (pages / BottomPlayer / FullscreenPlayer)
  → PlaybackIntent
  → Playback Session Engine V2 (SessionStore / Coordinator)
  → PlaybackQueue + PlaybackContext (слот активной сессии)
  → AudioPlayer.playTrack
  → (опционально) runtime fallback по SourceCopy
  → PlaybackResolver
  → MusicSourceAdapter / PlayerAdapter
  → HTMLAudioElement или Spotify Web Playback SDK
```

| Слой | Роль | Ключевые файлы |
|---|---|---|
| Intent | Старт из поиска, свайпа, альбома, волны, каталога | `src/services/playbackIntent/PlaybackIntent.ts` |
| Session Engine V2 | Пять независимых сессий, switch без потери слотов | `src/services/playbackSession/`, `src/services/sessionSwitch/` |
| Очередь | Единственная физическая очередь плеера + persist | `src/services/playbackQueue/PlaybackQueue.ts` |
| Контекст | Provenance (`album`, `playlist`, `swipe`, `search`, `search-seed`, …) | `src/types/playbackContext.ts` |
| Плеер | **Единственный** движок воспроизведения | `src/services/audioPlayer/AudioPlayer.ts` |
| UI плеера | Мини-бар + fullscreen overlay; не второй плеер | `BottomPlayer.tsx`, `FullscreenPlayer.tsx`, `playerStore.ts` |
| Recommendation / CME | Единый recommendation runtime, ownership по сессии | `src/services/recommendation/` |
| Resolver | URL / candidates через адаптер | `src/services/playbackResolver/PlaybackResolver.ts` |

**Пять музыкальных сессий:** `SWIPES`, `WAVE`, `SEARCH`, `CATALOG`, `ALBUM`.

**Зафиксировано в production (**отчёт** / **пользователь**):**

- Единый AudioPlayer; запрет второго GlobalPlayer / второй конкурирующей очереди / второго музыкального движка.
- SessionStore + Coordinator; durable sync; очереди, история, continuation, восстановление состояния.
- Recommendation Engine / CME (buffer, ownership, cold seed idle/epoch).
- SessionSwitch ON через runtime-config.

Технические детали CME / BUG-01 / buffer **10/5** / SWIPES ~70/30 / ALBUM related = same-artist при флаге — см. код и `docs/PLAYBACK_RELEASE_01.md`. Исторические runbook-формулировки «флаг по умолчанию OFF / выкладка не выполнялась» относятся к **моменту подготовки RELEASE-01**, не к текущему production.

---

## 3. Блок 2 — Навигация и плеер (**DONE**, production)

**Статус:** завершён. Пакет **RELEASE-NAV-01** установлен на S1 (**отчёт**: 2026-11-08 18:50:29). Пользователь **2026-11-09** подтвердил четыре основных сценария нового интерфейса.

### 3.1 Разделы UI

Четыре пункта основной навигации (**код** / **пользователь**):

1. **Свайпы** (`/`)
2. **Моя волна**
3. **Поиск** (`/search`)
4. **Библиотека** (`/library`) — каталоги и папки **внутри** Библиотеки

**Профиль** — в шапке (не отдельный пункт нижней навигации).

Устаревшая схема «Главная / Поиск / Библиотека / Профиль» как четыре вкладки нижней навигации — **не** актуальна.

### 3.2 Плеер

- Компактный мини-плеер (телефон / ПК / короткая landscape-магнитола).
- `FullscreenPlayer` — overlay поверх текущего раздела (`?player=full`); тот же `playerStore` / AudioPlayer; **без** второго AudioPlayer.
- Навигация разделов **отделена** от музыкальных сессий: смена вкладки сама по себе не стартует музыку и не обязана менять активную сессию.

### 3.3 Ключевые сценарии (**пользователь** 2026-11-09)

| Сценарий | Поведение |
|---|---|
| Search Play | SEARCH seed → экран Свайпов показывает колоду активной SEARCH-сессии → рекомендации |
| Catalog Play | CATALOG → автоматически FullscreenPlayer со списком композиций из queue |
| Мини ↔ Fullscreen | Overlay; закрытие возвращает на раздел без остановки музыки |
| Сессии | SWIPES / WAVE / SEARCH / CATALOG сохраняются при переключении UI |

Адаптивная компоновка: телефон (~390×844), ПК, магнитола (~1024×600) — заложена в CSS shell / fullscreen (**код**); отдельная проверка аппаратных кнопок руля — **не** закрыта (§12).

---

## 4. Canonical Track → SourceCopies → Playback

| Понятие | Смысл | Файлы |
|---|---|---|
| Source Track / SourceCopy | Идентичность провайдера: обычно `${sourceId}:${externalId}` | `src/types/canonical.ts`, `src/types/track.ts` |
| Canonical Track | Организация пользователя (лайк, каталоги), id `can_…` | `src/types/canonical.ts`, server `user_canonical_*` |
| Availability | Runtime-доказательство PLAYABLE, не часть identity | `src/types/playbackAvailability.ts`, `src/services/playbackAvailability/` |
| Playable selection | Выбор одной PLAYABLE copy **до** старта | `src/services/playbackAvailability/` |
| Runtime fallback | После ошибки — следующая известная copy той же композиции; очередь не двигается | `src/services/runtimeFallback/` |

Склейка поиска и дедуп свайп-ленты по canonical **не** сделаны (**код** / roadmap блок 3–4). Discovery-провайдеры в production-реестре пусты.

---

## 5. Источники музыки

Реестр и менеджер: `src/sources/SourceManager.ts`, `src/sources/registry.ts`.

| Источник | Статус на SHA снимка | Файлы |
|---|---|---|
| `mock` | Демо; исключается из «реальной» библиотеки / continuation | `src/sources/adapters/mock/`, `src/sources/demoSource.ts` |
| `yandex-music` | Experimental Device Flow; сессия на backend; **не переписывать** без отдельного решения | `src/sources/adapters/yandex-music/`, `server/providers/` |
| `local-folder` | File System Access + IndexedDB handle | `src/sources/adapters/local-folder/` |
| `spotify` | OAuth PKCE, SDK; нужен `VITE_SPOTIFY_CLIENT_ID` | `src/sources/adapters/spotify/` |
| `vk-music`, `zaycev`, custom | Заготовки | соответствующие `adapters/` |

Поиск: единый UI `/search` через активные адаптеры (`src/pages/Search.tsx` и search-слой источников).

---

## 6. Авторизация и хранение

| Данные | Где | Файлы |
|---|---|---|
| Аккаунт Swipe Music | SQLite + HttpOnly cookie `sm_session` | `server/http/authRoutes.ts`, `server/auth/` |
| Библиотека пользователя | SQLite `/api/me/*`, владелец только из сессии | `server/http/libraryRoutes.ts`, `server/library/` |
| Yandex provider session | Сервер, ключ шифрования вне Git (`.data` / `secrets` на машине) | `server/providers/`, клиент `sessionClient.ts` / `reconcileSession.ts` |
| Очередь / сессии | `localStorage` (+ SessionSwitch слоты) | `PlaybackQueue.ts`, session persistence |
| MediaIndex / local handles | IndexedDB | `src/services/mediaIndex/` |
| Тема | `localStorage` `swipe-music.theme` | `src/theme/` |

Секреты, `.env`, production SQLite и `provider-session.key` **не** коммитить. Пути `.data/`, `/data/`, `/secrets/` в `.gitignore`.

---

## 7. Аналитика прослушиваний

Клиент шлёт события из плеера; сервер хранит статистику пользователя.

- Клиент: `src/services/playbackAnalytics/` (`report.ts`, `runtime.ts`, …), вызовы из `AudioPlayer.ts`.
- Сервер: `server/library/playback/`.

Аналитика не меняет очередь и не подменяет источник.

---

## 8. UserTasteProfile

Приватный профиль вкуса из сигналов пользователя (лайки, прослушивания и т.д.).

| Часть | Файлы |
|---|---|
| Модель / расчёт | `src/services/taste/types.ts`, `buildTasteProfile.ts`, `weights.ts` |
| Клиентская загрузка | `src/services/taste/loadSessionTasteProfile.ts` — при включённом search-seed; поколение + владелец сессии; timeout |
| Привязка сессии | `src/store/authStore.ts` → `bindSessionTasteUser` |
| API | `GET /api/me/taste-profile` в `server/http/libraryRoutes.ts` |
| Ограничения ответа | `server/library/taste/presentTasteProfile.ts` (cap 500 tracks), rate limit в `server/auth/rateLimit.ts` |

`userId` из query/body **игнорируется**; гость → 401. Токены и stream URL в ответе не отдаются.

---

## 9. Recommendation Engine (единый runtime)

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
- **DEV acceptance:** источник `dev-acceptance` только при `import.meta.env.DEV && VITE_DEV_ACCEPTANCE=true`; WAV в `.data/dev-acceptance/audio` через Vite middleware (не `public/`, не в dist). Backend DEV: `DATABASE_PATH=.data/dev-acceptance/swipemusic.sqlite`. `scripts/dev-acceptance-prepare.mts` — пароль только ASCII alnum; файл **без** trailing newline. Серверная login-диагностика удалена (RELEASE-CLEANUP-16).
- **Recommendation Engine:** `seedArtists` — liked/taste раньше current; ранжирование штрафует same-artist dump.
- **Search hard-exclude:** при `search-seed` вся исходная выдача → `context.hardExcludeHits` (persist в queue); Next/ended/gesture не берут эти треки; swipe/wave/album не наследуют.
- Album / playlist: последовательный `queue.next`, не recommendation advance.
- Пустой вкус / нет источников → miss (`emptyReason`), не «персонализированный» hit.

Интеграционные тесты: `recommendation.integration.test.ts` (A–I), `searchRecommendation.integration.test.ts`.

### 9b. «Моя волна» (legacy)

`buildPersonalRadio` / `toggleMyWave` остаются в дереве для unit-тестов Personal Radio; UI и live runtime идут через Recommendation Engine (§9).

Известная проблема качества (**план**, RADIO-08): повторы и нерелевантные треки — **не исправлено** на уровне ранжирования ядра.

---

## 10. search-seed и автопродолжение

| Тема | Состояние | Файлы |
|---|---|---|
| Флаг сборки | DEV: включён. Production: `VITE_SEARCH_SEED_PLAYBACK` === точная строка `true` | `src/services/continuation/searchSeedPlayback.ts` |
| NAV-SEARCH-01 | Play из поиска → `playSearchTrack` (SEARCH session) → `/` с playback deck | `Search.tsx`, `Home.tsx`, `PlaybackIntent` |
| Поведение ON | Очередь = выбранный трек + continuation; hard-exclude hits | `commitSearchSeedQueue`, `libraryContinuation.ts`, … |
| Поведение OFF (legacy) | Очередь = список результатов поиска | `planSearchPlayback` |
| Advance | `AudioPlayer` next/ended → `playRecommendationAdvance` | `AudioPlayer.ts`, `recommendation/advance.ts` |

**Production (установленный frontend `2b7edb4`):** сценарий Search Play → SEARCH seed → экран Свайпов → рекомендации **принят пользователем 2026-11-09**. Не считать production «search-seed OFF».

**Команды сборки (для будущих релизов)**

```text
# Явное включение search-seed в production bundle
# PowerShell: $env:VITE_SEARCH_SEED_PLAYBACK='true'; npm run build

# Без флага production-сборка выключает search-seed path флагом
npm run build
```

Last.fm и MusicBrainz для рекомендаций **не** подключать.

---

## 11. Media Session и Android PWA

| Тема | Состояние | Файлы |
|---|---|---|
| Media Session | Код есть: pause/resume/next/previous → тот же AudioPlayer | `src/services/audioPlayer/mediaSession.ts` |
| Физические кнопки руля | **Не проверены** (**план** MEDIA-REMOTE-02) | — |
| PWA | `vite-plugin-pwa`, `registerType: 'autoUpdate'` | `vite.config.ts`, `index.html` |

Не объявлять успех руля / слышимого Яндекс-аудио на iPhone без протокола владельца.

---

## 12. Git (DEV) и Production

### 12.1 Репозиторий (**код / Git**)

- Remote `origin`: `medvedevachks/SwipeMusic`.
- Release candidate frontend: ветка `release/nav-player-01` @ `2b7edb48fe73e2f7c8a514b7d7043b2569103af2`.
- Документационная ветка снимка: `docs/arch-01-current-state` (от того же SHA).
- Проверки на RC (**отчёт** RELEASE-NAV-01 / NAV-CATALOG-01): **811 PASS**, lint PASS, build PASS.

### 12.2 Production (**отчёт** + **пользователь**)

| Параметр | Значение |
|---|---|
| ОС | Windows Server 2019 (S1) |
| Каталог | `C:\SwipeMusic` |
| Публичный URL | `https://app.swipe-music.site:8443` |
| Backend | `127.0.0.1:8787` за Caddy; code release **`3bea5bb`** |
| Frontend | **`2b7edb4`**, entry `assets/index-DbM2s51K.js` |
| Установка frontend | **2026-11-08 18:50:29** (RELEASE-NAV-01) |
| SessionSwitch | **true** (runtime-config / `.data/session-switch.flag`) |
| Backend / Caddy | работают (**отчёт**) |
| Git HEAD серверного worktree | `b403874`, dirty — **НЕ** показатель установленного frontend |
| Backup pre-NAV | `C:\SwipeMusic\backups\frontend-pre-RELEASE-NAV-01-20261108-183218` |
| SQLite / secrets | вне Git; frontend-only релиз их **не** трогает |
| start-backend.ps1 / Caddyfile / production.env | локальные настройки S1 — **не** перезаписывать без задачи |

Не путать: успешный `/api/health` ≠ новый frontend; серверный `git status` ≠ установленный `dist`.

---

## 13. Незавершённые вопросы (не смешивать с DONE блоками 1–2)

| ID / тема | Суть | Статус |
|---|---|---|
| SEARCH → SWIPES return | Возврат из SEARCH seed к обычной подборке SWIPES | Открыто |
| Deck UI remount | Сохранение UI-позиции колоды при remount | Открыто |
| ALBUM device | Отдельная device acceptance сессии ALBUM | **Не** объявлена пройденной |
| MEDIA-REMOTE-02 | Аппаратное управление магнитолы (руль / кнопки) | **Не** проверено |
| RADIO-08 | Качество рекомендаций (повторы / нерелевантность) | **План** |
| Блок 3 (библиотека) | Лайки, сохранение, сортировка, скрытие, организация каталогов | **NEXT**, UX не специфицирован |
| Блоки 4–5 | Поиск/альбомы; аккаунт/синхронизация | **PLANNED** |

Исторические задачи из старых снимков (PLAYBACK-DEV-09 повтор, UX-10 device, LIBRARY-UX deploy и т.д.) не поднимать как «текущий блок 1/2» — сверять с roadmap §0 и актуальной задачей пользователя.

---

## 14. Роли и жёсткие ограничения

1. Пользователь задаёт приоритеты.
2. ChatGPT — главный архитектор.
3. Cursor — исполнитель по согласованной задаче.
4. Не переписывать рабочий Yandex flow без отдельного решения.
5. Не подключать Last.fm / MusicBrainz для рекомендаций.
6. Не создавать второй GlobalPlayer / вторую очередь / второй музыкальный движок.
7. Не обходить лицензии сервисов.
8. Не терять незакоммиченные изменения; не `force push` / `reset --hard` / `clean` без явного разрешения.
9. Не публиковать секреты, токены, cookies, содержимое SQLite.
10. Не менять production без согласованной задачи; не удалять user SQLite и secrets.
11. Не включать experimental-функции без явного решения; SessionSwitch в production — только backend runtime-config.
12. После реализации — проверяемый отчёт: SHA, тесты/lint/build, ограничения, что не проверено.
13. Не объявлять пройденными ALBUM device acceptance, кнопки магнитолы или слышимый Yandex на iPhone без протокола владельца.

Инструкции агента: `AGENTS.md`, `.cursor/rules/swipe-music.mdc`. Продуктовое определение MVP: `docs/MVP_V1.md`. Статус этапов MVP (может отставать от release-фокуса): `docs/ROADMAP_MVP_V1.md`.

---

## 15. Что сознательно не является источником истины

| Документ / сигнал | Почему осторожно |
|---|---|
| `GPT.md` | Снимок более раннего кода |
| `RELEASE_REPORT.md` | Старые утверждения вокруг ранних SHA |
| `docs/PLAYBACK_RELEASE_01.md` | Runbook подготовки движка; формулировки «ещё не выложено / OFF» устарели относительно текущего production |
| Серверный Git HEAD `b403874` | Dirty worktree ≠ установленный frontend `2b7edb4` |
| `docs/yandex-music.md` / части `docs/providers.md` | Могут описывать stub |

При сомнении: **код @ `2b7edb4` → этот файл → Git log `release/nav-player-01` → только потом исторические md**.

---

## 16. Быстрый чеклист для нового агента

1. `git rev-parse HEAD` / `git status` — сверить с этим снимком и задачей.
2. Прочитать §0 (roadmap), §2–3 (DONE блоки), §12 (production SHA), §13 (открытое).
3. Production frontend = `2b7edb4` / `index-DbM2s51K.js`; backend = `3bea5bb`; SessionSwitch **ON**.
4. Следующий продуктовый блок — **библиотека и каталоги**; UX блока 3 не выдумывать.
5. Не деплоить на Server без задачи RELEASE и доступа к `C:\SwipeMusic` **на S1**.
6. Не считать RADIO-08, руль, ALBUM device и «реальный Yandex PASS на iPhone» закрытыми без протокола владельца.
7. Application-секреты, `.data/**`, `PASSWORD.txt` не читать в отчёты и не коммитить.
