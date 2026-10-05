# SwipeMusic — current state snapshot

Снимок кода, не история и не план. План: [docs/MVP_V1.md](docs/MVP_V1.md), [docs/ROADMAP_MVP_V1.md](docs/ROADMAP_MVP_V1.md).

## Git

- Репозиторий: https://github.com/r-sh-galimov/SwipeMusic
- Ветка разработки: `feature/mvp-04-canonical-track`
- Baseline ветки: `c7e9f4e` (`feat: add universal catalog management UI`) на `feature/mvp-03-universal-catalogs`
- Опубликованный `origin/main`: `475fd34`
- Локальный commit аккаунта: `f4995d3`. Восстановление пароля: `1aa61c9`
- MVP-02A (серверное хранение библиотеки) зафиксирован коммитом `feat: add server persistence API`
- MVP-02B (frontend читает и пишет эту библиотеку) зафиксирован коммитом `feat: persist user library state`
- MVP-03A (каталог вместо категории, совместимое хранение) зафиксирован коммитом `feat: introduce universal music catalogs`
- MVP-03B (список, создание, открытие, переименование, удаление каталога и снятие трека) зафиксирован коммитом `feat: add universal catalog management UI`. Playback каталога не входит в MVP-03
- MVP-04A (канонический трек и копии источников, без склейки UI) зафиксирован коммитом `feat: add canonical track identity layer`
- MVP-04B1 (состояние композиции и canonical-членство каталога) зафиксирован коммитом `feat: add canonical library persistence`
- MVP-04B2 (frontend-организация через CanonicalTrack) зафиксирован коммитом `feat: use canonical tracks for user organization`
- MVP-05A (модель availability и resolver, без fallback) зафиксирован коммитом `feat: add playback availability layer`
- Локальный clone поверхностный (`grafted`)

## Стек

React 19, TypeScript, Vite 8, Tailwind 4, Zustand, React Router 7, `vite-plugin-pwa`. Скрипты: `dev`, `dev:auth`, `build`, `lint`, `test`, `preview`.

Account backend: Node.js, `node:sqlite`, HTTP API `/api/auth/*` и `/api/me/*`. На Node 22+ модуль `node:sqlite` работает без флага и помечен runtime как experimental (stability 1.1).

## Экраны

`MainLayout`: шапка, страница, постоянный `BottomPlayer`, нижняя навигация. Переход между маршрутами плеер не уничтожает.

| Путь | Экран |
|---|---|
| `/` | Сортировка, колода свайпов. Нужна сессия |
| `/search` | Поиск. Результат можно открыть как колоду |
| `/library` | Библиотека |
| `/queue` | Очередь |
| `/profile` | Профиль: имя, фамилия, email, выход. Ссылки на очередь и источники сохранены |
| `/sources` | Источники |
| `/login` | Вход. Для анонима. Ссылка «Забыли пароль?» |
| `/register` | Регистрация: имя, фамилия, email, пароль |
| `/forgot-password` | Запрос восстановления. Ответ не говорит, есть ли email |
| `/reset-password` | Новый пароль по одноразовой ссылке. Без автоматического входа |

## Воспроизведение

Фактическая цепочка:

```text
UI
→ PlaybackIntent
→ PlaybackQueue + PlaybackContext
→ AudioPlayer.playTrack
→ PlaybackResolver
→ PlaybackCandidate
→ PlayerManager.load
→ PlayerAdapter
→ HTML Audio (local / https / preview) или Spotify Web Playback SDK
```

`PlaybackContext`: `album`, `playlist`, `swipe`, `search`, `library`, `none`. Типа `catalog` нет. `album` и `playlist` блокируют тихую подмену очереди со свайпа.

Жесты по умолчанию: влево — лайк, вправо — категория, вверх — «дальше» (классификация, не skip плеера), вниз — назад по колоде. «Дальше» и «Назад» также двигают плеер.

## Providers

| Provider | Статус в коде |
|---|---|
| `mock` | Демо-лента, включена по умолчанию, удалить нельзя |
| `local-folder` | Папка через File System Access API |
| `spotify` | OAuth PKCE, поиск, sync, preview, Premium SDK. Нужен `VITE_SPOTIFY_CLIENT_ID` |
| `yandex-music` | Experimental. Только OAuth Device Flow. Ручного user token нет |
| `vk-music`, `zaycev`, `custom-website` | Заготовки, пустые результаты |

## Yandex Music

Файлы: `src/sources/adapters/yandex-music/`. Backend, worker и отдельного token-ввода нет.

- Вход: Device Flow (`/api/yandex-oauth` → `oauth.yandex.ru`). Код показывается на `/sources`, user code копируется в буфер.
- Ручной token: нет.
- Refresh: `refreshToken` сохраняется и нигде не вызывается.
- Сессия: `localStorage`, ключ `sm-provider:yandex-music:authSession`, JSON с access/refresh token, без шифрования. IndexedDB и backend для токена нет.
- Dev-log не пишет значение access token. В ошибку попадают до 240 символов тела ответа.
- В коде есть: account status, search, чтение лайков, чтение до 30 плейлистов, sync в MediaIndex, stream/preview candidates, disconnect. Live в этой сессии не проверялся.
- Прокси Vite только в dev: `/api/yandex-music`, `/api/yandex-oauth`, `/api/yandex-fetch`.

`docs/yandex-music.md` и раздел «вариант A» в `docs/providers.md` устарели: там ещё stub.

## Хранение

| Данные | Где |
|---|---|
| Очередь и PlaybackContext | `localStorage` `swipe-music-playback-queue-v1` |
| Включённые источники | `localStorage` `swipe-music.source-enabled` |
| Токены Spotify и Yandex | `localStorage` `sm-provider:<id>:authSession`, открытый JSON |
| MediaIndex | IndexedDB |
| Handle и снимок local-folder | IndexedDB |
| Кэш плагинов | IndexedDB |
| Каталоги, лайки, назначения, история, `gestureConfig`, Collection Engine | сервер SQLite после входа. `GET /api/me/library-state` — источник истины. В JSON каталоги по-прежнему в поле `categories`. До гидратации экран сортировки скрыт |
| Серверная библиотека пользователя | SQLite: `user_categories`, `user_collection_tracks`, `user_category_tracks`, `user_history`, `user_settings`, `user_canonical_tracks`, `user_track_source_copies`, `user_canonical_library_tracks`, `user_catalog_canonical_tracks`. Владелец берётся из сессии, не из URL |
| Недавний поиск | только память вкладки |
| Аккаунт Swipe Music | SQLite `.data/swipemusic.sqlite`: `users`, `sessions`, `password_reset_tokens` |
| Сессия аккаунта | HttpOnly cookie `sm_session`. В БД хранится только SHA-256 токена. В localStorage токена нет |
| Reset token | Только SHA-256 в БД, 30 минут, одноразовый. Ссылка живёт в письме, не в браузерном хранилище |

`users.id` — UUID. Пароль хранится как `scrypt$v1$...`. После сброса пароля удаляются все сессии пользователя, библиотека остаётся. Серверные timestamp — ISO 8601 UTC. Foreign keys включены (`PRAGMA foreign_keys = ON`), пользовательские строки ссылаются на `users.id` с `ON DELETE CASCADE`. API удаления аккаунта нет. Лимит запросов восстановления держится в памяти процесса и сбрасывается после перезапуска сервера.

## Каталог и трек

- Пользовательский контейнер — каталог Swipe Music, не плейлист провайдера. В коде это тот же тип, что раньше назывался Category. Таблицы `user_categories` / `user_category_tracks` и маршруты `/api/me/categories` не переименовывались: старые строки читаются как каталоги, id сохраняются.
- Экран `/library` показывает «Мои каталоги» и «Моя музыка». Карточка каталога: `/library/catalogs/:catalogId`. Можно создать, открыть, переименовать, удалить свой каталог и убрать композицию из него. Удаление каталога не удаляет композицию и лайк. Системный каталог удалить нельзя.
- Число треков каталога и строки внутри него считаются по canonical membership. Несколько SourceCopy одной композиции дают одну строку и один вклад в счётчик.
- «Доступные треки» на `/library` остаются каталогом провайдера или демо. Поиск и лента свайпа тоже остаются source tracks и не склеиваются.
- Source Copy — идентичность провайдера, поиска и playback: `${sourceId}:${externalId}`. История хранит этот source snapshot.
- Canonical Track — идентичность пользовательской организации: один лайк и один набор каталогов на композицию. Id — `can_<uuid>` пользователя. Он не принадлежит провайдеру и не хранит playback URL.
- `user_collection_tracks` хранит снимок source track и старый ключ. `user_canonical_library_tracks.liked` — источник истины лайка. `user_catalog_canonical_tracks` — членство каталога. Старая `user_category_tracks` остаётся для совместимости. Новые действия лайка и каталога её не пишут.
- Склейка поиска, дедуп ленты свайпа, playback fallback и playback каталога не сделаны. У строки «Моя музыка» нет Play.
- Playback availability — отдельное runtime-состояние SourceCopy, не часть canonical identity и не SQLite. `PLAYABLE` доказывается проверкой. `UNKNOWN` значит, что доказательств ещё нет, и не считается playable. Подключение аккаунта не доказывает доступность конкретного трека. Resolver не выбирает источник и не запускает плеер.
- `MediaIndex` — дедупликация индекса устройства. Canonical identity — серверное состояние вошедшего пользователя. Matcher их не связывает и библиотеку сам не склеивает.
- Пользовательская организация переживает reload, logout/login и перезапуск backend. Source Track id по-прежнему `${sourceId}:${externalId}`. Организация адресуется canonical id.

## Ограничения

- Библиотека пишется на сервер сразу после действия. Очереди офлайн-мутаций и разрешения конфликтов нет. Две вкладки при первом пустом аккаунте могут создать два набора default categories.
- Между устройствами нет live sync: второе устройство видит данные после своего login/reload.
- Подтверждения email нет.
- Смена пароля из уже открытого профиля нет: только сценарий «забыл пароль».
- Нет Car Mode.
- VK и Zaycev не подключены.
- Cross-provider fallback есть только если MediaIndex уже склеил копии. Отдельного UX подписки нет.
- `npm test`: 103 теста. 22 auth, 16 server persistence, 5 matcher, 4 canonical identity, 15 canonical library, 8 frontend persistence, 3 catalog UI/domain, 14 frontend canonical organization, 16 playback availability. `viewedTrackIds`, очередь, плеер, MediaIndex, токены провайдеров и handle папки остаются локальными. `collectionId` / `collectionName` тоже локальные и в серверную схему не входят.
