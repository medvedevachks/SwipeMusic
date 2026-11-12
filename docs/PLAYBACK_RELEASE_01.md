# PLAYBACK-RELEASE-01 — выпуск SessionSwitch на Windows Server

Документ для будущего обновления. Сам сервер этим коммитом не меняется.
Пока нет отдельного разрешения, не подключаться к production, не деплоить и не включать новый движок.

## Что выпускается

Релизный коммит — HEAD ветки `feature/playback-session-store-v2` после локальных проверок.
На момент подготовки:

| | SHA |
|---|---|
| DEV | `593d6c6` плюс коммит этого runbook |
| `origin/feature/deploy-windows-01` | `83a7be8` |
| Локальная `feature/deploy-windows-01` | `4a0b7cf`, разошлась с origin |

`83a7be8` является предком DEV: выпуск на origin — fast-forward, без merge.
Локальную `feature/deploy-windows-01` не выкладывать. Коммит `4a0b7cf` в DEV не входит.
Перед копированием файлов на сервер записать SHA, который реально запущен. Если он не предок релизного коммита — остановиться.

В этих 25 коммитах нет правок `server/db`. SQLite-схема не меняется. Новые таблицы не создаются этим diff.

## Данные пользователя

| Данные | Где | Что делает обновление |
|---|---|---|
| Учётная запись, cookie | SQLite `users`, `sessions` | Не трогает |
| Библиотека, каталоги, лайки | `user_canonical_*`, `user_categories`, `user_catalog_canonical_tracks` | Не трогает. Canonical migrate идемпотентна и не удаляет provider session |
| Яндекс Музыка | `user_provider_connections.encrypted_session` | Не трогает. Повторный Device Flow не нужен, если файл БД и ключ шифрования те же |
| PlaybackSessionStore v2 | `localStorage` `swipe-music-playback-sessions-v2/*` | Старый клиент эти ключи не читает и не удаляет |
| Старая очередь v1 | `localStorage` `swipe-music-playback-queue-v1` | Не импортируется в v2 и не удаляется |
| Настройки UI | `localStorage` темы и источников | Не связаны с флагом |

Выключение SessionSwitch не вызывает `clearForLogout` и не чистит библиотеку.

## Feature flag

По умолчанию новый движок **OFF**. Первый запуск новой сборки его не включает.

Клиент читает `GET /api/runtime-config` → `{ "sessionSwitch": false }`.
Ответ без секретов, `Cache-Control: no-store`. Ошибка сети, не-200 или битый JSON → OFF.

Сервер решает так:

1. Если файл `.data/session-switch.flag` есть, включено только когда в нём ровно `1`.
2. Если файла нет, включено только при `SWIPE_SESSION_SWITCH=1`.
3. Ошибка чтения файла → OFF, даже если env равен `1`.

В production `localStorage` ключ `swipe-music-session-switch-integration-v1` **игнорируется**.
Пользователь не может включить движок себе или другим. Отдельной админ-кнопки нет.
На DEV этот ключ по-прежнему включает приёмку, если сервер не прислал `true`.

Рекомендация для сервера: env не задавать. Управлять только файлом, чтобы удаление или запись `0` гасила флаг без отката к env.

ALBUM related continuation после конца альбома выполняется только при флаге ON. При OFF плеер останавливается, как раньше.

## Backup

Делать на сервере до замены файлов. Секреты не копировать в git и не вставлять в отчёт.
База production: `C:\SwipeMusic\data\swipemusic.sqlite`.
Это не каталог `.data` из DEV. Файл флага туда не класть.

Утилита `sqlite3.exe` на сервере не требуется. Снимок делает `VACUUM INTO` через `node:sqlite` из Node.js 24. Команда согласована с открытой базой и забирает WAL. Копирование файла проводником при живых подключениях не использовать.

Локально на Node.js 22 тот же приём проверен на временной базе с двумя открытыми подключениями: `integrity_check` = `ok`, строка в копии сохранилась. На production этот скрипт не запускался.

1. Узнать рабочий SHA: в `C:\SwipeMusic` выполнить `git rev-parse HEAD` и записать его в `C:\swipe-music-backups\<timestamp>\GIT_SHA.txt`.
2. Создать каталог `C:\swipe-music-backups\<timestamp>`.
3. Сохранить скрипт снимка и выполнить его. `STAMP` заменить на имя каталога:

```powershell
@'
import { DatabaseSync } from "node:sqlite"
const dest = process.argv[1].replaceAll("\\", "/").replaceAll("'", "''")
const db = new DatabaseSync("C:/SwipeMusic/data/swipemusic.sqlite")
db.exec(`VACUUM INTO '${dest}'`)
db.close()
'@ | Set-Content -Encoding utf8 C:\swipe-music-backups\backup-sqlite.mts
node --experimental-strip-types C:\swipe-music-backups\backup-sqlite.mts C:\swipe-music-backups\STAMP\swipemusic.sqlite
```

4. Проверка копии, не боевого файла:

```powershell
@'
import { DatabaseSync } from "node:sqlite"
const db = new DatabaseSync(process.argv[1], { readOnly: true })
console.log(db.prepare("PRAGMA integrity_check").get())
console.log(db.prepare("SELECT COUNT(*) AS n FROM user_provider_connections").get())
db.close()
'@ | Set-Content -Encoding utf8 C:\swipe-music-backups\check-sqlite.mts
node --experimental-strip-types C:\swipe-music-backups\check-sqlite.mts C:\swipe-music-backups\STAMP\swipemusic.sqlite
```

`integrity_check` должен быть `ok`. Число подключений печатать можно, столбец `encrypted_session` не выбирать. Размер копии не должен быть 0.

5. Секреты с ACL: `robocopy C:\SwipeMusic\secrets C:\swipe-music-backups\<timestamp>\secrets /E /COPY:DATSO /R:1 /W:1`. Файлы не открывать и не класть в репозиторий.
6. Скопировать рабочий Caddyfile, `C:\SwipeMusic\dist` и каталог backend так, чтобы их можно было вернуть целиком.
7. `MANIFEST.txt`: SHA, время, путь SQLite, путь dist, путь серверного кода. Без содержимого секретов.

Восстановление репетировать на копии. Боевой файл базы копией не заменять: иначе пропадут записи, появившиеся после снимка.

## Выпуск

Точка остановки есть после каждого шага. При сомнении не переходить дальше.

1. На сервере записать SHA, `git status` и что `origin/feature/deploy-windows-01` совпадает с ожидаемым предком. Если рабочий SHA не предок релизного коммита — стоп.
2. Backup по разделу выше.
3. `PRAGMA integrity_check` на копии = `ok`.
4. Релизный коммит — fast-forward от записанного production SHA. Merge и rebase на сервере не делать.
5. На машине сборки: `npm test`, `npm run lint`, `npm run build`. В `dist` не должно быть значений секретов из env.
6. Заменить frontend `dist` и backend-код. Файл `C:\SwipeMusic\.data\session-switch.flag` не создавать. В `production.env` переменную `SWIPE_SESSION_SWITCH` не добавлять. Перезапуск backend — только когда оператор дошёл до этого шага по отдельному разрешению. Caddy уже проксирует `/api/*`, отдельное правило для `/api/runtime-config` не нужно.
7. Smoke старого движка: логин тем же аккаунтом, Яндекс остаётся подключённым без нового Device Flow, Play/Next/Pause одного реального трека, библиотека и каталоги на месте.
8. Включение: создать `C:\SwipeMusic\.data\session-switch.flag` с одним символом `1` и перезагрузить страницу. `GET /api/runtime-config` должен показать `sessionSwitch: true`. Само по себе обновление файлов флаг не включает. Уже звучащая вкладка переходит на новое чтение флага после перезагрузки; перезагрузка библиотеку не удаляет.
9. Проверка Яндекс Музыки на ПК: реальный трек, не WAV. Слышимый звук подтверждает человек.
10. Пять сессий: SWIPES, WAVE, SEARCH, CATALOG, ALBUM. Переключение туда и обратно, очередь каждой сессии на месте.
11. Телефон и Android-магнитола: тот же аккаунт, Play и один Next. Автопереход по окончании трека слушать отдельно; `playing=true` звуком не считается.
12. Оставить ON только если шаги 9–11 приняты. Иначе сценарий A отката.

## Rollback

### A. Выключить движок, сборку оставить

1. В `C:\SwipeMusic\.data\session-switch.flag` записать `0` или удалить файл, если env не задан.
2. Перезагрузить страницу. `GET /api/runtime-config` → `sessionSwitch: false`.
3. Новый Play идёт через старый PlaybackIntent. Уже открытая вкладка подхватывает флаг при следующей загрузке или при следующем auth restore.
4. Библиотеку, каталоги, лайки и `user_provider_connections` не удалять.
5. Ключи v2 в браузере можно оставить: старый путь их не читает.

### B. Вернуть предыдущие файлы

1. Сначала сценарий A, чтобы клиенты перестали звать новый движок.
2. Вернуть сохранённые `dist` и backend с backup.
3. Базу не заменять, если `integrity_check` боевого файла `ok`. Подмена боевой базы копией откатывает лайки, появившиеся после backup.
4. Этот выпуск не меняет схему SQLite, поэтому старый код совместим с той же базой. Если будущий релиз добавит необратимую миграцию, его нельзя выкладывать этим runbook.

После любого отката: логин, Яндекс без нового Device Flow, один Play, каталоги на месте.
