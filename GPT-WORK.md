# SwipeMusic — отчёт о проделанной работе

Документ для передачи контекста другому GPT. Это описание этапа, а не снимок архитектуры. Снимок кода: [GPT.md](GPT.md). Цель продукта: [docs/MVP_V1.md](docs/MVP_V1.md). Статусы этапов: [docs/ROADMAP_MVP_V1.md](docs/ROADMAP_MVP_V1.md).

Канонический репозиторий: https://github.com/medvedevachks/SwipeMusic  
Исторический upstream: https://github.com/r-sh-galimov/SwipeMusic

Защищённый Car MVP baseline: commit `888f5e2`, ветка `checkpoint/car-mvp-foundation`, tag `car-mvp-foundation`. Задача, которая ломает существующий Yandex flow, не считается выполненной. Стабилизация Yandex отложена: текущую интеграцию не переписывать без отдельного решения.

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
MVP-04 — DONE
MVP-04A — DONE, commit `feat: add canonical track identity layer`
MVP-04B — DONE
MVP-04B1 — DONE, commit `feat: add canonical library persistence`
MVP-04B2 — DONE, commit `feat: use canonical tracks for user organization`
MVP-05 — DONE
MVP-05A — DONE, commit `feat: add playback availability layer`
MVP-05B — DONE, commit `feat: add playable source selection`
MVP-06 — DONE
MVP-06A — DONE, commit `feat: add runtime playback fallback`
MVP-06B — DONE, commit `feat: add playback fallback user experience`
```

Следующий приоритет: Car MVP. Стабилизация Yandex отложена и не начинается вместе с VK, Zaycev или Car Mode. Текущий Yandex flow остаётся замороженным baseline `888f5e2`.

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
- История по-прежнему хранит source track. `GET /api/me/library-state` сохраняет прежние поля. На момент MVP-04B1 экраны ещё не были переключены. Поиск не склеивается. Playback fallback нет.

## MVP-04B2 — Frontend canonical organization

Сделано на ветке `feature/mvp-04-canonical-track` от `f0769fc`. Commit: `feat: use canonical tracks for user organization`.

- После входа рядом с `GET /api/me/library-state` загружается `GET /api/me/canonical-library`. Старый bootstrap остаётся: снимки источников, история, `gestureConfig` и Collection Engine.
- Лайк, снятие лайка и членство каталога идут через `ensureCanonicalForTrack`, затем PATCH/PUT/DELETE canonical API. Клиент не передаёт `userId`. Новые действия не пишут `user_category_tracks` и не считают `user_collection_tracks.liked` источником истины.
- «Моя музыка» и карточка каталога показывают одну строку на CanonicalTrack. Счётчик каталога считает композиции, не копии. «Доступные треки», поиск и лента свайпа остаются source tracks.
- История после успешного свайпа хранит source Track, с которым взаимодействовали. Playback, провайдеры и жесты не менялись. У canonical-строки нет Play, fallback нет.
- Logout очищает canonical state до загрузки следующего пользователя.
- `npm test`: прежние 73 и 14 тестов frontend canonical organization. Lint и build проходят. Старое предупреждение oxlint в `ProviderAuthPanel.tsx` не исправлялось.

## MVP-05A — Playback availability foundation

Сделано на ветке `feature/mvp-05-playback-availability` от `f1481c8`. Commit: `feat: add playback availability layer`.

- CanonicalTrack остаётся постоянной идентичностью. SourceCopy остаётся копией провайдера. PlaybackAvailability — эфемерная runtime-возможность и не пишется в SQLite.
- `resolveCanonicalPlaybackAvailability` считает статус каждой копии. Сначала дешёвые условия: копия, регистрация адаптера, поддержка playback, включённость источника и auth. Сетевой probe не вызывается, если уже ясно `NOT_CONNECTED`, `AUTH_REQUIRED` или `UNSUPPORTED`.
- `UNKNOWN` не равен `UNAVAILABLE` и не считается playable. Подключённый аккаунт без track probe остаётся `UNKNOWN`. Ошибка сети остаётся `UNKNOWN`. No-rights становится `SUBSCRIPTION_REQUIRED`.
- Local playable только при выданной папке и handle файла. Mock/demo с preview — `PLAYABLE`. VK, Zaycev и custom stub не помечаются playable.
- Короткий session cache сбрасывается при `invalidatePlaybackAvailabilityBySource` и при logout. Availability store отделён от canonical identity store.
- PlaybackResolver, очередь и плеер не менялись. Автовыбор источника, приоритет провайдеров и fallback не делались.

## MVP-05B — Playable source selection

Сделано на ветке `feature/mvp-05-playback-availability` от `9f09162`. Commit: `feat: add playable source selection`.

- Availability по-прежнему только доказывает, что copy `PLAYABLE`. Selector выбирает одну такую copy до playback.
- Явный Play source Track передаётся как `preferredSourceTrackKey`. Если эта copy `PLAYABLE`, она сохраняется. Продуктового приоритета провайдеров нет. Без предпочтения порядок — `sourceTrackKey` по возрастанию.
- Если preferred copy уже не `PLAYABLE`, другая `PLAYABLE` copy выбирается до старта. Это `PRE_PLAY_ALTERNATIVE`, не runtime fallback. Ошибка playback не запускает вторую copy.
- Нет `PLAYABLE` copy — `NO_PLAYABLE_COPY`. `UNKNOWN` и stub `UNSUPPORTED` не выбираются. OAuth и подписка не открываются.
- Track для существующего PlaybackResolver берётся из снимка коллекции. SourceCopy полного Track и playback URL не хранит. Нет снимка — `TRACK_SNAPSHOT_MISSING`, URL не создаётся.
- `prepareCanonicalPlayback` не вызывает AudioPlayer. Поиск, свайп, каталог и очередь не переписывались. У строки «Моя музыка» Play не добавлялся.
- VK, Zaycev и Custom остаются заготовками. Auth и playback Yandex и Spotify не менялись.

## MVP-06A — Generic runtime fallback

Сделано на ветке `feature/mvp-06-runtime-fallback` от `335fdfd`, commit `feat: add runtime playback fallback`.

- Fallback engine не содержит веток по именам провайдеров. Новый provider позже становится fallback-ready через регистрацию, SourceCopy, availability и существующий playback path. Discovery — необязательное расширение.
- `buildCanonicalSourceInventory` отдаёт только известные SourceCopy этой композиции. Зарегистрированный адаптер без SourceCopy не создаёт копию и не попадает в группы подписки или подключения.
- `AlternateSourceDiscoveryProvider` и пустой production-реестр заложены. Результат: `FOUND`, `NOT_FOUND`, `AMBIGUOUS`, `UNSUPPORTED`, `ERROR`. `AMBIGUOUS` и неподтверждённый кандидат SourceCopy не создают. Автоматический discovery в playback не вызывается. Реализаций для Yandex, Spotify, Local, VK, Zaycev и Custom нет.
- `RuntimePlaybackFallbackOrchestrator` пытается только `PLAYABLE` копии того же `canonicalTrackId`. Порядок: preferred, если она `PLAYABLE`, затем остальные по `sourceTrackKey`. Каждый ключ — одна попытка. Сессия эфемерная, в SQLite не пишется.
- Политики: `OFF`, `ASK`, `AUTO`. По умолчанию для canonical fallback — `AUTO`. `ASK` после ошибки возвращает `CONFIRMATION_REQUIRED` и не стартует следующую copy. Car Mode позже использует тот же `AUTO`.
- Ошибка playback не записывается как вечный `UNAVAILABLE`. Pause, Next, Previous и новый ручной Play fallback не запускают: Next/Previous и новый Play отменяют сессию. Индекс очереди оркестратор не меняет.
- Поздний результат старой попытки игнорируется через generation и `AbortController`. Перед следующей попыткой предыдущая останавливается. При ошибке позиция передаётся в следующую попытку, если порт умеет seek.
- Исчерпанный результат группирует известные не-playable копии: subscription, not connected, auth, unavailable, unknown, unsupported. Это данные для UX, не сам UX.
- Событие `PlaybackSourceChanged` с причиной `RUNTIME_FALLBACK` публикуется при переключении. Экраны поиска, свайпа, библиотеки и `BottomPlayer` сами fallback не содержат: они приходят в `AudioPlayer.playTrack`.
- `routeLivePlayback` подключён к этому `playTrack`. Нет canonical mapping или меньше двух известных копий — остаётся прежний source playback. Иначе orchestrator ведёт попытки. Ошибка старта и media error уже начатого playback без pending switch попадают в сессию. Next/Previous сначала отменяют сессию, затем двигают очередь прежним механизмом. Stop и logout отменяют сессию. Pause не отменяет её и не считается ошибкой.
- VK, Zaycev и Custom не реализованы. Auth, stream и discovery Yandex и Spotify не менялись.

## MVP-06B — Alternative source UX

Сделано на ветке `feature/mvp-06-alternative-source-ux` от `0fd18b2`, commit `feat: add playback fallback user experience`.

- Runtime fallback остаётся generic. UI не ветвится по `sourceId`. Имя источника берётся из существующей metadata.
- Успешный AUTO показывает неблокирующее уведомление о смене источника и не оставляет ошибку первой копии. Музыка не ставится на паузу, очередь не двигается.
- ASK показывает подтверждение. Следующая copy стартует только после согласия и только в той же fallback-сессии. Отмена, другой трек, Next и logout делают подтверждение недействительным.
- Терминальный лист показывает известные SourceCopy и безопасный статус. Подписка, «не подключён» и повторная авторизация ведут на существующий `/sources`. Покупки и нового auth нет.
- `UNKNOWN` можно проверить снова: кэш availability сбрасывается, playback сам не стартует. `UNSUPPORTED` не предлагает подключение или подписку.
- Зарегистрированный provider без SourceCopy этой композиции в лист не попадает. Discovery по-прежнему выключен.
- Ручной выбор другой `PLAYABLE` copy отменяет текущую сессию и играет её через существующий плеер с `preserveQueue`.
- Ошибка source Track без canonical mapping остаётся у прежнего player error. Logout очищает эфемерный UX. В SQLite он не пишется.

