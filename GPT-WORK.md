# SwipeMusic — отчёт о проделанной работе

Документ для передачи контекста другому GPT. Это описание этапа, а не снимок архитектуры. Снимок кода: [GPT.md](GPT.md). Цель продукта: [docs/MVP_V1.md](docs/MVP_V1.md). Статусы этапов: [docs/ROADMAP_MVP_V1.md](docs/ROADMAP_MVP_V1.md).

Репозиторий: https://github.com/r-sh-galimov/SwipeMusic  
Ветка `main`, коммит `475fd34`.

## Что было сделано

Выполнен **этап 0 — Baseline MVP v1.0**. Это аудит и документация. Новые функции не писались. Функциональный код не менялся. Commit и push не делались. Этап User Account не начинался.

Итог: `MVP-00: DONE`.

## Что проверено

- Git: локальный HEAD совпадает с `origin/main` (`475fd34`). Ahead/behind: 0/0. Clone поверхностный: в логе виден один коммит, дерево совпадает с опубликованным `main`.
- `npm run lint` — успешно. Есть старое предупреждение oxlint в `ProviderAuthPanel.tsx`. Не исправлялось.
- `npm run build` — успешно. Есть предупреждения про размер чанка и dynamic import. Не исправлялись.
- Автотестов нет: в `package.json` нет скрипта `test`.
- Dev smoke: страницы `/`, `/search`, `/library`, `/queue`, `/profile`, `/sources` открываются. Нижний плеер при переходах не сбрасывается.
- Docker не запускался: это не входило в задачу.

## Главный вывод по Yandex

В текущем дереве **нет** более новой интеграции через ручной пользовательский token.

Фактически есть только OAuth Device Flow: поиск, чтение лайков и плейлистов, sync, кандидаты на стрим. Сессия пишется в `localStorage` без шифрования. `refreshToken` сохраняется и не используется. Живой аккаунт в этой сессии не проверялся.

Старые тексты, где Yandex назван stub, признаны устаревшими и помечены, но не удалены:

- `docs/yandex-music.md`
- раздел «вариант A» в `docs/providers.md`

## Что зафиксировано в документации

| Файл | Роль |
|---|---|
| `GPT.md` | короткий снимок текущего кода |
| `docs/MVP_V1.md` | утверждённое определение MVP v1.0 |
| `docs/ROADMAP_MVP_V1.md` | этапы 0–19 со статусами по факту кода |
| `GPT-WORK.md` | этот отчёт о работе |

## Состояние продукта на момент аудита

Аккаунта Swipe Music нет: нет регистрации, `userId` и backend. Категории, лайки и история живут в памяти вкладки и пропадают при перезагрузке. Id трека в коллекции — `${sourceId}:${externalId}`. В MediaIndex уже есть склейка копий, но это ещё не пользовательский Canonical Track.

Провайдеры:

- `mock` — демо, работает
- `local-folder`, `spotify`, `yandex-music` — код есть, live в этой сессии не подтверждался
- `vk-music`, `zaycev`, `custom-website` — заготовки

## Что сознательно не делалось

Не было рефакторинга, правок UI, Swipe Engine, поиска, плеера, Yandex, VK, Zaycev и аккаунта. Найденные предупреждения сборки не чинились. Секреты в отчёты не копировались.

## Грязное дерево

Кроме документации изменён `package-lock.json` (около 120 удалённых строк после `npm install`). К baseline-документации он не относится. Его не откатывали и не коммитили.

## Следующий этап

Не начат был на момент baseline. После него выполнен MVP-01A, см. ниже.

```text
MVP-01 — User Account = DONE
MVP-01A — DONE, commit f4995d3
MVP-01B — DONE, commit 1aa61c9
MVP-02 — DONE
MVP-02A — DONE, commit `feat: add server persistence API`
MVP-02B — DONE, commit `feat: persist user library state`
MVP-03 — DONE
MVP-03A — DONE, commit `feat: introduce universal music catalogs`
MVP-03B — DONE, commit `feat: add universal catalog management UI`
MVP-04 — PARTIAL
MVP-04A — DONE, commit `feat: add canonical track identity layer`
MVP-04B — PARTIAL
MVP-04B1 — DONE, commit `feat: add canonical library persistence`
MVP-04B2 — TODO
```

Следующий этап: MVP-04B2, переход экранов библиотеки, каталогов и свайпа на Canonical Track. Поиск и playback в этот переход не входят.

## MVP-01B — Password recovery

- `POST /api/auth/forgot-password` отвечает одинаково, есть email или нет.
- `POST /api/auth/reset-password` меняет пароль тем же scrypt, гасит все сессии и не создаёт новую.
- Токен случайный, в БД только hash, 30 минут, одноразовый. Новый запрос гасит предыдущие активные токены.
- Письма идут через `MailSender`. Development: `MAIL_TRANSPORT=console`. Production требует SMTP и не принимает console transport.
- Лимит запросов: IP + email, в памяти процесса, сбрасывается после перезапуска сервера.
- Экраны `/forgot-password` и `/reset-password`. На входе есть «Забыли пароль?».
- `npm test`: прежние 9 тестов и новые тесты восстановления проходят. Позже весь набор — 22 auth-теста, commit `1aa61c9`.

## MVP-01A — Account backend + sessions

Сделано на ветке `feature/mvp-01-user-account` от `475fd34`, commit `f4995d3`.

- Backend `server/`: регистрация, вход, `GET /api/auth/me`, выход.
- Пользователь с UUID, email в нижнем регистре, пароль только как scrypt hash.
- Сессия 30 дней, cookie `sm_session` HttpOnly, SameSite=Lax. В БД только hash токена.
- База `.data/swipemusic.sqlite` в `.gitignore`.
- Frontend: `/login`, `/register`, блок на профиле, защита маршрутов, восстановление сессии после reload.
- Плееры, свайп, поиск, источники и MediaIndex не переписывались.

## MVP-02A — Server data model + authenticated API

Сделано на ветке `feature/mvp-02-server-persistence` от `1aa61c9`. Commit: `feat: add server persistence API`.

- Та же SQLite `.data/swipemusic.sqlite`. Новые таблицы: `user_categories`, `user_collection_tracks`, `user_category_tracks`, `user_history`, `user_settings`.
- Владелец только из cookie-сессии. Маршрутов с `userId` в URL нет.
- Лайк — поля `liked` / `likedAt` на строке коллекции, не отдельная таблица.
- Назначение категории — отдельная связь, idempotent. Удаление категории снимает назначения и не удаляет трек. Системную категорию API не удаляет.
- История — append `HistoryEntry` / `SwipeAction`, снимок трека внутри записи. Лимит 1–200, по умолчанию 100.
- Настройки — только `gestureConfig`. Токены провайдеров и playback URL не принимаются.
- `GET /api/me/library-state` отдаёт categories, tracks, categoryAssignments, history, settings.
- Frontend stores не переключались. Logout и сброс пароля библиотеку не стирают.
- `npm test`: 22 auth + 15 persistence, все проходят.

## MVP-02B — Frontend persistence integration

Сделано на ветке `feature/mvp-02-server-persistence` поверх `214657a`. Commit: `feat: persist user library state`.

- После `authenticated` + `user.id` один bootstrap: `GET /api/me/library-state`. Повторный запрос той же сессии в полёте склеивается. Снимок сервера заменяет память, старое состояние вкладки не сливается.
- Пустой аккаунт один раз создаёт текущие default categories и перечитывает снимок. Непустой аккаунт defaults не создаёт заново.
- Лайк, категория, назначение, история и `gestureConfig` пишутся из store/Collection Engine, не из одного экрана. Каталожный `addTrack` на сервер не уходит.
- Collection Engine гидратируется через `replaceStorageData`.
- Logout очищает user-scoped runtime и не удаляет серверную библиотеку.
- Ошибка сохранения показывает «Не удалось сохранить изменения.» Ответ 401 переводит существующий auth store в `anonymous`.
- Локально остаются `viewedTrackIds`, `collectionId` / `collectionName`, action log, очередь, плеер, поиск, MediaIndex, провайдеры и handle папки.
- `npm test`: прежние 37 и 6 тестов frontend persistence.

## MVP-03A — Catalog domain + compatibility

Сделано на ветке `feature/mvp-03-universal-catalogs` от `233881d`. Commit: `feat: introduce universal music catalogs`.

- Продуктовая сущность — `Catalog`. `Category` — то же самое тип-алиас, второй модели нет.
- Таблицы `user_categories` и `user_category_tracks`, маршруты `/api/me/categories` и поле истории `category` оставлены. Старые строки читаются как каталоги, id не меняются.
- Каталог принадлежит пользователю и не хранит providerId. Треки внутри сохраняют `${sourceId}:${externalId}`.
- Жест вправо по-прежнему открывает picker. Подпись жеста и тексты picker — «Каталог».
- Системные пресеты те же шесть. `createDefaultCatalogs` — та же функция, что `createDefaultCategories`.
- Провайдерский плейлист не равен каталогу. Canonical Track и playback каталога не делались.

## MVP-03B — Catalog UI

Сделано на ветке `feature/mvp-03-universal-catalogs` от `067638f`. Commit: `feat: add universal catalog management UI`.

- На `/library` блок «Мои каталоги»: иконка, имя, число треков по назначениям, `sortOrder`. Создание переиспользует форму каталога и `createCategory`.
- Карточка `/library/catalogs/:catalogId`: название, иконка, описание, треки из снимка коллекции, источник через общее имя источника. Чужой или отсутствующий id показывает «Каталог не найден».
- Переименование идёт через `updateCategory`. Удаление своего каталога спрашивает подтверждение и возвращает в `/library`. Системный каталог кнопки удаления не имеет, `deleteCategory` его не трогает.
- «Убрать из каталога» снимает одно назначение. Трек, лайк, история и членство в других каталогах остаются. Удаление каталога снимает только его назначения.
- Жест вправо и «В каталог» в меню трека по-прежнему пишут в тот же store. Playback каталога нет.

## MVP-04A — Canonical track foundation

Сделано на ветке `feature/mvp-04-canonical-track` от `c7e9f4e`. Commit: `feat: add canonical track identity layer`.

- `Track.id` = `${sourceId}:${externalId}` остаётся ключом Source Copy. Канонический id — `can_<uuid>` пользователя.
- Таблицы `user_canonical_tracks` и `user_track_source_copies` добавляются рядом со старыми. Коллекция, каталоги и история не переписываются.
- Первая встреча source track создаёт один canonical и одну копию. Автосклейки библиотеки нет.
- Связать копии можно через `POST /api/me/tracks/link`. Операция транзакционная, идемпотентная и только внутри пользователя. `unlink` отделяет копию на новый canonical.
- Matcher отвечает `MATCH` / `NO_MATCH` / `AMBIGUOUS` и сам записи не объединяет. UI, поиск, провайдеры и playback не менялись.

## MVP-04B1 — Canonical library and catalog persistence

Сделано на ветке `feature/mvp-04-canonical-track` от `33372dd`. Commit: `feat: add canonical library persistence`.

- Состояние композиции лежит в `user_canonical_library_tracks`. Членство каталога — в `user_catalog_canonical_tracks`. Снимок источника остаётся в `user_collection_tracks` с ключом `${sourceId}:${externalId}`.
- Перенос старого аккаунта идёт без fuzzy matching. Уже связанные копии получают одно состояние и один набор каталогов. Повторный запуск не дублирует строки. Маркер `canonical-library-v1` пишется только после успешной транзакции.
- `link` переносит состояние и объединяет каталоги. `liked` побеждает `disliked`. Заметки и конфликтующие metadata не выбрасываются. `unlink` оставляет каталоги у исходной композиции, а отделённая копия получает пустое состояние.
- Удаление каталога снимает canonical membership и не удаляет композицию. Удаление source snapshot не удаляет Canonical Track и остальные копии.
- История по-прежнему хранит source track. `GET /api/me/library-state` сохраняет прежние поля. Экраны не переключены. Поиск не склеивается. Playback fallback нет.
