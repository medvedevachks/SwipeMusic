# Swipe Music — актуальное состояние проекта

**Назначение документа:** единый снимок для нового Cursor-аккаунта или нового чата.
Читать **этот файл раньше**, чем `GPT.md` и `RELEASE_REPORT.md`. Исторические документы не удалять; при расхождении достовернее код, Git и этот снимок.

| Поле | Значение |
|---|---|
| Дата снимка | 2026-10-28 |
| Канонический репозиторий | https://github.com/medvedevachks/SwipeMusic |
| Ветка снимка | `feature/deploy-windows-01` |
| Проверенный HEAD | `3dc112d3333e46c910693a9d4a376a7bd5f96964` |
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

## 8. «Моя волна»

Подбор из библиотеки / лайков: `src/services/personalRadio/recommend.ts` (`buildPersonalRadio`), запуск `myWaveRuntime.ts`, `toggleMyWave.ts`.

- По умолчанию selection = `library` (`radioSelection.ts`).
- **Taste-radio OFF** в обычном UI; DEV-override только через `sessionStorage` и `import.meta.env.DEV`.
- Continuation поиска **не** вызывает `buildPersonalRadio`.

Известная проблема качества волны (**план**, RADIO-08): повторы и нерелевантные треки, в т.ч. повторяющийся «Комсомольск-на-Амуре» — **не исправлено**.

---

## 9. search-seed и автопродолжение

| Тема | Состояние | Файлы |
|---|---|---|
| Флаг | DEV: включён. Production: только если build-time `VITE_SEARCH_SEED_PLAYBACK` === точная строка `true` | `src/services/continuation/searchSeedPlayback.ts`, `src/vite-env.d.ts`, `.env.example` |
| Поведение ON | Очередь = один выбранный трек; дальше кандидаты из канонической библиотеки | `commitSearchSeedQueue`, `libraryContinuation.ts`, `ContinuationSession.ts`, `searchContinuationRuntime.ts` |
| Поведение OFF | Очередь = список результатов поиска (legacy) | `planSearchPlayback` |
| UI | Search / Home search-deck | `src/pages/Search.tsx`, `src/pages/Home.tsx` |
| Advance | `AudioPlayer` next/ended → `consumeSearchSeedAdvance` | `AudioPlayer.ts` |
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
- HEAD снимка: ветка `feature/deploy-windows-01` (search-seed + SEARCH-FLOW-04 persist `sessionTailIds`).
- SEARCH-CONTINUATION-PROD (`3dc112d`) и search-flow фиксы **в ветке**; на production ещё не выкатывались (**отчёт**).
- Локальная приёмка SEARCH-FLOW-04: **377** теста PASS, lint/build OFF и ON.
- Baseline внутри истории ветки: `14fc4cb` (Media Session) — предок `3dc112d`.

### 11.2 Production (**только операторский отчёт**, с DEV-ПК путь `C:\SwipeMusic` недоступен)

| Параметр | Значение из отчёта |
|---|---|
| ОС | Windows Server 2019 |
| Каталог | `C:\SwipeMusic` |
| Публичный URL | `https://app.swipe-music.site:8443` |
| Backend | `127.0.0.1:8787` за Caddy |
| Установленный код | `14fc4cb` |
| Backup | `C:\SwipeMusic\backups\release-20261028-002505` |
| `3dc112d` | **не** развёрнут |
| search-seed | OFF |
| Media Session | в установленном коде есть; руль не проверен |
| SQLite / secrets | вне Git, сохранять при обновлениях |

Не путать: успешный `/api/health` ≠ новый frontend установлен.

---

## 12. Незавершённые задачи (не считать DONE)

| Приоритет | Задача | Суть |
|---|---|---|
| **1** | RELEASE-SEARCH этапы 2/3 | На сервере: backup → ff до `3dc112d` → `npm run build` **без** флага → smoke (вход, Яндекс, волна, аналитика, taste 401/owner). Затем, только после живого Яндекса: сохранить OFF-dist, пересобрать с `VITE_SEARCH_SEED_PLAYBACK=true`, проверить PWA/SW, цепочку поиска. Откат search-seed = вернуть OFF-статику. |
| **2** | RADIO-08 | Убрать нерелевантные и повторяющиеся треки «Моей волны» (в т.ч. «Комсомольск-на-Амуре»). |
| **3** | MEDIA-REMOTE-02 | Проверить физические кнопки руля на Android-магнитоле. |

Не начинать RADIO-08 и не включать search-seed незаметно. Car Mode / VK / Zaycev — только по отдельному решению.

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

1. `git rev-parse HEAD` → ожидать `3dc112d` (или новее по явной задаче).
2. Прочитать этот файл целиком.
3. Не деплоить на Server без задачи RELEASE и доступа к `C:\SwipeMusic`.
4. Не считать RADIO-08 и руль закрытыми.
5. Application-секреты и `.data/*.sqlite` не читать в отчёты и не коммитить.
