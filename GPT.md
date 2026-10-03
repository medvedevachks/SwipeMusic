# SwipeMusic — current state snapshot

Снимок кода, не история и не план. План: [docs/MVP_V1.md](docs/MVP_V1.md), [docs/ROADMAP_MVP_V1.md](docs/ROADMAP_MVP_V1.md).

## Git

- Репозиторий: https://github.com/r-sh-galimov/SwipeMusic
- Ветка разработки: `feature/mvp-01-user-account`
- Опубликованный `origin/main`: `475fd34`
- Локальный commit аккаунта: `f4995d3` (`feat: add user account and session foundation`)
- MVP-01B (восстановление пароля) есть в рабочем дереве и ещё не закоммичен
- Локальный clone поверхностный (`grafted`)

## Стек

React 19, TypeScript, Vite 8, Tailwind 4, Zustand, React Router 7, `vite-plugin-pwa`. Скрипты: `dev`, `dev:auth`, `build`, `lint`, `test`, `preview`.

Account backend: Node.js, `node:sqlite`, HTTP API только для `/api/auth/*`. На Node 22.19 модуль `node:sqlite` работает без флага и помечен runtime как experimental (stability 1.1).

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
| Категории, лайки, история, CollectionEngine | только память вкладки |
| Недавний поиск | только память вкладки |
| Аккаунт Swipe Music | SQLite `.data/swipemusic.sqlite`: `users`, `sessions`, `password_reset_tokens` |
| Сессия аккаунта | HttpOnly cookie `sm_session`. В БД хранится только SHA-256 токена. В localStorage токена нет |
| Reset token | Только SHA-256 в БД, 30 минут, одноразовый. Ссылка живёт в письме, не в браузерном хранилище |

`users.id` — UUID. Пароль хранится как `scrypt$v1$...`. После сброса пароля удаляются все сессии пользователя. Каталоги по-прежнему не на сервере. Лимит запросов восстановления держится в памяти процесса и сбрасывается после перезапуска сервера.

## Каталог и трек

- Категории есть. Один `trackId` может быть в нескольких категориях.
- Идентификатор трека в UI и коллекции: `${sourceId}:${externalId}`.
- `MediaIndex` уже хранит `copies[]` и умеет склеивать записи по ISRC / MusicBrainz / hash / title+artist+duration. Это ещё не пользовательский Canonical Track.
- Пользовательская организация не переживает перезагрузку и не отделена от id источника.

## Ограничения

- Каталоги, лайки и история ещё не привязаны к аккаунту и не синхронизируются между устройствами. Это MVP-02.
- Подтверждения email нет.
- Смена пароля из уже открытого профиля нет: только сценарий «забыл пароль».
- Нет Car Mode.
- VK и Zaycev не подключены.
- Cross-provider fallback есть только если MediaIndex уже склеил копии. Отдельного UX подписки нет.
- Автотесты есть у auth backend (`npm test`), включая восстановление пароля.
