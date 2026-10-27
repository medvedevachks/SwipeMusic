# RELEASE-ALL-01

Дата проверки: 2026-10-27.

Ветка: `feature/deploy-windows-01`.

Production в этом выпуске не обновлён. Публичный сайт отвечает, но с этой машины нет доступа к каталогу сервера, поэтому код туда не выкладывался и рабочая SQLite не копировалась.

## Git

До выпуска `origin/feature/deploy-windows-01` был на `3f9e77a`.

Push выполнен обычным fast-forward:

`3f9e77a..14fc4cb` → `https://github.com/medvedevachks/SwipeMusic.git`

`HEAD` и `origin/feature/deploy-windows-01` совпадают: `14fc4cb65e81e868f05b395a2d483afea1522542`.

Force push не использовался. `git add .` не использовался. `.tmp`, базы, ключи, сертификаты и env в коммиты не входили.

| SHA | Коммит | Изолированная проверка |
| --- | --- | --- |
| `4f935f50943bf7c671ab216ae2420450251a4a9a` | fix: add a draggable night-safe theme switch | Уже был локально до этой задачи |
| `24ee76b1cc71320c52dece89159be6c51d958cb4` | fix: keep a compact theme switch in the header and profile | Уже был локально до этой задачи |
| `4456d59898302732f39b95cd5f019f32e4d4739a` | feat: align the global player chrome with the night theme | 256 тестов, lint, build, `git diff --check` |
| `4c0a6eb68115b90413427337e56be369f08d8ebd` | feat: record signed-in playback without changing the queue | 274 теста, lint, build, `git diff --check` |
| `42d800c2844835d97663d79007f2ba187e241378` | feat: derive a private taste profile from playback history | 275 тестов, lint, build, `git diff --check` |
| `91195dc1a1032a533cfd18565a2f25de63d1a41c` | feat: keep the demo catalog out of the real library | 275 тестов, lint, build, `git diff --check` |
| `2363af6e7a1ba65eccf025780122382b2bb256d9` | feat: add my wave and library continuation for one search | 347 тестов, lint, build, `git diff --check` |
| `14fc4cb65e81e868f05b395a2d483afea1522542` | feat: forward media session commands to the existing player | 358 тестов, lint, build, `git diff --check` |

На финальном дереве: `npm test` — 358, 0 падений; `npm run lint` — код 0, прежнее предупреждение `ProviderAuthPanel.tsx:188`; `npm run build` — успешно; `git diff --check` — чисто.

Lint-предупреждение и предупреждения сборки о размере чанка и `INEFFECTIVE_DYNAMIC_IMPORT` существовали до выпуска и не исправлялись.

Сверка с резервной копией исходников: все 431 файла совпали, кроме порядка тестовых файлов в `package.json`. Набор тестов тот же.

## Что вошло

- Ночной интерфейс, переключатель темы, карточка, нижний плеер и рамка макета.
- GlobalPlayer: отмена устаревшего `load()`, параллельный сбор SourceCopy без сопоставления по названию, короткий кэш адреса потока Яндекса в памяти процесса.
- «Моя волна» из библиотеки, без демо-каталога. Подбор по вкусу в радио остаётся выключенным: по умолчанию `library`, в production `loadSessionTasteProfile` возвращает `null`.
- Аналитика прослушивания: таблицы `user_playback_events` и `user_playback_stats` добавляются через `CREATE TABLE IF NOT EXISTS`. Удаления таблиц нет.
- Профиль вкуса считается из истории пользователя. `GET /api/me/taste-profile` вне development отвечает `404`.
- Поиск одной композиции и библиотечное продолжение есть в коде. В production-сборке `isSearchSeedPlaybackEnabled()` возвращает `false` до любого флага.
- Media Session вызывает те же `pause`, `resume`, `next` и `previous`, что и экран. Повторная команда отбрасывается только на время синхронной публикации состояния. Панель диагностики есть только в Vite DEV и в production-сборке строки «Dev · Media Session» нет.
- Last.fm и MusicBrainz не подключались.

## Резервная копия DEV

Приватная копия: `C:\Users\Крис\.tmp\swipemusic-dev-backup-20261027`.

Внутри 431 файл и `BACKUP-MANIFEST.sha256`. Каталог `.git` тоже скопирован. Не копировались `node_modules`, `dist`, `.data`, `.certs`, `secrets`, `.tmp`, `.env`, sqlite и ключи. Рабочее дерево не сбрасывалось и файлы из него не удалялись.

Контрольные SHA-256 до разбиения коммитов совпали у `libraryRoutes.ts`, `authStore.ts`, `AudioPlayer.ts`, `Sources.tsx`, `package.json` и `HEAD`.

## Production

Проверено снаружи:

- `https://app.swipe-music.site:8443/api/health` — `200 {"ok":true}`.
- `https://app.swipe-music.site:8443/` — `200`, сервер `Caddy`, `Last-Modified: Sun, 25 Oct 2026 21:00:11 GMT`, ресурс `assets/index-DBTioejJ.js`.
- Порт 443 на эту проверку не ответил. Новые порты, туннели и правила файрвола не открывались.
- `https://app.swipe-music.site` без порта в этой проверке не использовался как признак обновления.
- Локального `C:\SwipeMusic` на этой машине нет. Это Windows 10, не сервер выпуска.
- Git HEAD сервера, службы, файл SQLite и возможность восстановления базы отсюда не читались.

Пока на сервере отдаётся `index-DBTioejJ.js`, установленная PWA не содержит этот выпуск. Успешный health не означает, что новый код установлен.

## Почему выкладка остановлена

Канонический порядок — на сервере: резервная копия `C:\SwipeMusic\data\swipemusic.sqlite`, затем `git pull --ff-only`, `npm run build`, перезапуск backend. Отсюда нет оболочки сервера, поэтому backup базы не делался и код не переключался. Пользовательская база не удалялась и не изменялась.

`package-lock` не менялся. После pull нужен `npm run build`, потому что изменился frontend. `npm ci` нужен только если lockfile изменится. Caddy перезагружать не нужно, если Caddyfile не менялся: новая статика читается из `C:\SwipeMusic\dist`.

## Включение поиска после проверки зависимостей

Сейчас не включать. Сначала на уже выложенном `14fc4cb` проверить вход, воспроизведение Яндекса, переход на другую копию источника, смену трека, «Мою волну», обычный поиск и запись аналитики.

Отдельное включение — маленький следующий коммит только в `isSearchSeedPlaybackEnabled()`:

- в production возвращать одну константу `SEARCH_SEED_PRODUCTION_ENABLED`;
- поставить её `true` и заново собрать `dist`;
- быстрое выключение — вернуть константу в `false`, заново собрать `dist` и заменить статику;
- базу, радио и режим taste не трогать.

Пока этой константы нет: production-ветка функции сразу возвращает `false`. Режим taste для радио остаётся выключенным.

## Откат кода

Откат не удаляет `C:\SwipeMusic\data\swipemusic.sqlite`, `secrets\` и ключ провайдера.

Если сервер уже перешёл на `14fc4cb` и новый код нужно убрать:

```text
git checkout 3f9e77a
npm run build
```

Затем остановить backend и снова запустить `deploy\windows\start-backend.ps1`. Новые таблицы можно оставить: старый код их не читает. Удалять файл базы для отката кода нельзя.

До выкладки откат не требуется: сервер остаётся на прежней статике от 25 октября 2026.

## Что ещё не доказано

Физические кнопки руля не проверялись. Пока журнал на магнитоле не покажет `received` вместе с вызовом плеера, работу кнопок считать неподтверждённой.

Живой production-smoke входа, Яндекса, SourceCopy, очереди, радио, поиска и аналитики для `14fc4cb` не выполнялся.
