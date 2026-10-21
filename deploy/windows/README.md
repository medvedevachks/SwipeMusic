# Swipe Music на Windows Server 2019

Этот каталог описывает будущий запуск. Он ничего не устанавливает и не настраивает сервер.

Docker не используется. Backend слушает только `127.0.0.1:8787`. Порт 8787 не пробрасывается в интернет и не открывается в файрволе наружу.

```text
Internet
→ DNS app.swipe-music.site
→ NAT 80/443
→ Windows Server
→ Caddy (сертификат домена выпускает сам)
   ├─ статический C:\SwipeMusic\dist
   └─ /api/* → 127.0.0.1:8787
→ Node backend
→ SQLite / Yandex
```

Публичный адрес сайта — `https://app.swipe-music.site`. Production-процесс — `node --experimental-strip-types server/index.ts`. Для этого нужен Node.js 22 или новее; на DEV проверен Node 22.23.3. Этот процесс не запускает Vite и не раздаёт файлы репозитория. Пример Caddy отдаёт только `C:\SwipeMusic\dist`. Живой Caddyfile на сервере этим репозиторием не проверяется.

В development Vite только пересылает `/api/*` на тот же backend. Отдельного Vite-прокси для Яндекса больше нет.

## Клиентский IP и лимиты входа

Backend слушает только loopback, поэтому сам видит адрес Caddy, а не посетителя. Клиентский IP читается из `X-Swipe-Client-Ip` только если TCP-сосед — `127.0.0.1` или `::1`. Caddyfile обязан перезаписывать этот заголовок значением `{http.request.remote.host}`; пример уже делает это через `header_up`. Заголовок `X-Forwarded-For` не используется: его может подделать клиент.

Лимиты login и register хранятся в памяти одного процесса. Рестарт их обнуляет, второй процесс их не видит. Старые отметки удаляются, число ключей ограничено; при переполнении самые старые корзины вытесняются. Это не общий Redis и не постоянная блокировка аккаунта. Без заголовка Caddy все посетители считались бы одним адресом `127.0.0.1`.

POST, PUT, PATCH и DELETE требуют `Origin` из доверенного списка: origin `APP_PUBLIC_URL` и `https://app.swipe-music.site`. `Host` и `X-Forwarded-Host` этот список не меняют. Чужой Origin и `Sec-Fetch-Site: cross-site` получают `403 FORBIDDEN_ORIGIN`. Запрос без Origin тоже отклоняется: так нельзя обойти проверку. Браузер сам отправляет Origin. Скрипты и тесты должны указать его явно. `GET` и `HEAD` этой проверкой не закрываются.

`/api/yandex-fetch` ходит только на `https://storage.mds.yandex.net:443`. TCP-соединение открывается на адрес, который уже прошёл проверку, с SNI и проверкой сертификата для этого имени. Повторный DNS lookup для выбора адреса не используется. Редирект проверяется заново. Один срок в 8 секунд покрывает DNS до соединения, заголовки и полное чтение тела. Прокси `/api/yandex-music` использует тот же срок, включая чтение тела, и не буферизует ответ больше 32 МиБ.

## Каталоги

Сборка и постоянные данные разделены. Повторный `npm run build` заменяет `dist\` и не удаляет базу, ключ шифрования и сертификаты.

```text
C:\SwipeMusic\
    dist\          собранный frontend/PWA
    server\        код backend
    data\
        swipemusic.sqlite
    secrets\       вне Git: production.env и provider-session.key
    deploy\
        windows\
```

База, `PROVIDER_SESSION_KEY` и закрытые ключи сертификатов не кладутся в `dist\`. Каталог `secrets\` тоже не входит в Git.

## Секреты

Шаблон переменных: `deploy/windows/env.example`.

Ключ сессии провайдера, 32 байта, base64:

```text
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Напечатанное значение — секрет. Его нельзя коммитить, писать в логи и класть в `dist\`. Сохранить его нужно вне Git, в `C:\SwipeMusic\secrets\provider-session.key`. Остальные production-переменные — в `C:\SwipeMusic\secrets\production.env`. В файл окружения ключ не класть: launcher читает `PROVIDER_SESSION_KEY` только из файла ключа и не печатает его.

В `NODE_ENV=production` backend не стартует без валидного `PROVIDER_SESSION_KEY` и без SMTP. Это требование не ослабляется.

Почта сброса пароля использует уже существующий SMTP-код:

```text
MAIL_TRANSPORT=smtp
SMTP_HOST=<SMTP_HOST>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<SMTP_USER>
SMTP_PASSWORD=<SMTP_PASSWORD>
SMTP_FROM=<SMTP_FROM>
```

Настоящие пароль, ключ и сертификаты в репозиторий не входят.

`APP_PUBLIC_URL` для этого запуска — `https://app.swipe-music.site`. Ссылки сброса пароля собираются из него. Тот же origin уже есть в доверенном списке CSRF: backend всегда принимает `https://app.swipe-music.site`, а origin `APP_PUBLIC_URL` добавляет ещё раз. Отдельный `APP_ALLOWED_ORIGINS` для домена не нужен. `Host` по-прежнему этот список не меняет.

## Яндекс

Сессия Яндекса остаётся на backend в зашифрованном виде. Браузер не получает сохранённый token обратно и не хранит его в `localStorage`.

`/api/yandex-oauth/device/code` и `/api/yandex-oauth/token` проксируют только эти два шага Device Flow на `https://oauth.yandex.ru`. Нужна сессия Swipe Music.

`/api/yandex-fetch` нужен только для XML download-info. Разрешён один HTTPS-хост: `storage.mds.yandex.net`. Локальные, частные и link-local адреса отклоняются. Редирект на запрещённый хост не выполняется. Cookie и Authorization браузера на upstream не уходят.

## Запуск backend

Секреты лежат вне Git, в `C:\SwipeMusic\secrets`.

Сначала проверка, затем запуск. `preflight.ps1` только читает базу, окружение, ключ, сборку, порт и git status. Он не пишет файлы, не ставит службы и не трогает Caddy. Пароль SMTP, `PROVIDER_SESSION_KEY` и содержимое `provider-session.key` не печатаются.

Проверка дополнительно требует, чтобы `DATABASE_PATH` после нормализации абсолютного Windows-пути совпал с `C:\SwipeMusic\data\swipemusic.sqlite`, `PORT` был целым `8787`, а `MAIL_TRANSPORT` оставался `smtp`. `APP_PUBLIC_URL` должен быть абсолютным `https` без query, fragment, localhost и `127.0.0.1`. Для доменного запуска это `https://app.swipe-music.site`. Строка `PROVIDER_SESSION_KEY` в `production.env` запрещена: ключ читается только из `provider-session.key`. Рядом должен лежать `deploy/windows/start-backend.ps1`. Git должен игнорировать `data/swipemusic.sqlite`, `secrets/provider-session.key` и `secrets/production.env`.

Если файла базы ещё нет, проверка пишет `[WAIT] Database` и всё равно может закончиться `PRE-FLIGHT: READY`. Пустой файл базы — это `FAIL`. Каталог `data` и сам файл создаёт первый запуск `start-backend.ps1`: backend вызывает создание SQLite по `DATABASE_PATH`. До этого запуска файл создавать вручную не нужно.

```text
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\preflight.ps1

powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\start-backend.ps1
```

Пока SMTP не заполнен, первая команда сообщает `PRE-FLIGHT: NOT READY`. Это ожидаемый результат, а не аварийный след. Когда SMTP заполнен и остальные проверки проходят, она сообщает `PRE-FLIGHT: READY`. Backend запускают после READY.

`start-backend.ps1` находит корень репозитория относительно себя, загружает `production.env`, проверяет, что ключ — это canonical base64 на 32 байта, и запускает каноническую команду `node --experimental-strip-types server/index.ts`. Backend по-прежнему слушает только `127.0.0.1`. Пути к секретам можно переопределить параметрами `-EnvFile` и `-ProviderKeyFile`.

## Канонический порядок

Tracked-код на production вручную не редактируется. `data\` и `secrets\` не проходят через Git. Порт 8787 наружу не публикуется. Backend слушает только `127.0.0.1:8787`. SMTP-провайдер задаётся только переменными `SMTP_*`. Gmail, Brevo и любой другой совместимый relay не требуют правок application code.

Локальный backend считается готовым только после трёх результатов. Публичный `https://app.swipe-music.site` проверяется отдельно, после запуска Caddy:

```text
PRE-FLIGHT: READY
BACKEND SMOKE TEST: PASS
SMTP TEST: PASS  # именно test-smtp.ps1 -SendTest -To <email>
```

`SMTP TEST: PASS` даёт только `test-smtp.ps1 -SendTest -To <email>` после успешной отправки письма через Nodemailer. `SMTP DIAGNOSTIC: PASS` подтверждает конфигурацию, DNS и TCP и не заменяет эту отправку.

DEV PC / Cursor:

```text
npm test
npm run lint
npm run build
commit
push
```

Windows Server:

```text
git status --short
git pull --ff-only
git rev-parse HEAD
npm ci
npm run build
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\preflight.ps1
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\start-backend.ps1
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\test-backend.ps1
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\test-smtp.ps1
```

`npm ci` нужен, когда изменились dependencies или lockfile. `npm run build` нужен, когда изменился frontend. `test-backend.ps1` только читает уже запущенный процесс. `test-smtp.ps1` без `-SendTest` письмо не отправляет: это диагностика параметров, DNS и TCP. Если они корректны, итог `SMTP DIAGNOSTIC: PASS`. Пока нет `SMTP_PASSWORD`, скрипт пишет `[WAIT] SMTP credentials` и `SMTP DIAGNOSTIC: NOT READY`. Финальное подтверждение SMTP — только `test-smtp.ps1 -SendTest -To <email>` и строка `SMTP TEST: PASS`.

## DNS и HTTPS

Доменный запуск не использует отдельный IP-сертификат и не требует Posh-ACME. Caddy сам выпускает и обновляет сертификат для `app.swipe-music.site`, когда в Caddyfile указано имя сайта и нет ручной директивы `tls` с файлами сертификата.

Нужны такие DNS-записи у регистратора домена `swipe-music.site`:

```text
app.swipe-music.site.    A       <публичный IPv4 сервера>
app.swipe-music.site.    AAAA    <публичный IPv6, если он есть>
```

Сам адрес в репозиторий не записывается. Пока запись не указывает на этот сервер, Caddy сертификат не получит.

Снаружи открыты только порты 80 и 443. Порт 80 нужен Caddy для проверки ACME и для перехода на HTTPS. Порт 443 — сам сайт. Порт 8787 наружу не публикуется и в файрволе не открывается. Эти правила репозиторий не создаёт.

Пример сайта: `deploy/windows/Caddyfile.example`. Статика берётся из `C:/SwipeMusic/dist`. Запросы `/api/*` идут на `127.0.0.1:8787` с заголовком `X-Swipe-Client-Ip`. Для маршрутов SPA стоит `try_files {path} /index.html`, поэтому обновление `/login`, `/sources` и `/reset-password` остаётся на `index.html`, а `/api/*` туда не попадает.

## Порядок первого запуска

Команды выполняет оператор на сервере. Этот шаг репозитория их не запускает и production не меняет.

Подготовка сервера, без публичного сайта:

1. Создать DNS-записи выше и дождаться, пока имя `app.swipe-music.site` указывает на сервер.
2. Пробросить NAT только для 80 и 443. Порт 8787 не публиковать.
3. Получить нужную ветку: `git checkout feature/deploy-windows-01`.
4. Установить зависимости: `npm ci`.
5. Записать секреты вне Git. Скопировать `deploy/windows/env.example` в `C:\SwipeMusic\secrets\production.env` и заменить значения в угловых скобках. `APP_PUBLIC_URL` оставить `https://app.swipe-music.site`. Ключ провайдера записать в `C:\SwipeMusic\secrets\provider-session.key`. Оба файла не коммитить.
6. Собрать frontend: `npm run build`. Результат — `dist\`. Файл базы на этом шаге не создавать.

Запуск backend:

7. Проверить готовность. Отсутствующая база даёт `[WAIT] Database` и не мешает `PRE-FLIGHT: READY`. `PRE-FLIGHT: NOT READY` означает, что backend запускать рано.

```text
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\preflight.ps1
```

8. Запустить backend. Первый запуск создаёт `C:\SwipeMusic\data\swipemusic.sqlite`. Процесс слушает только `127.0.0.1:8787`.

```text
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\start-backend.ps1
```

9. Проверить локальный процесс и почту. Это ещё не проверка домена.

```text
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\test-backend.ps1

powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\test-smtp.ps1

powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\test-smtp.ps1 -SendTest -To <email>
```

Ожидаются `BACKEND SMOKE TEST: PASS`, затем `SMTP DIAGNOSTIC: PASS` без отправки и `SMTP TEST: PASS` только после `-SendTest`.

Публичный сайт:

10. Поставить Caddy и взять за основу `deploy/windows/Caddyfile.example`. Путь `C:/SwipeMusic/dist` — это `C:\SwipeMusic\dist`. Ручной сертификат не подставлять: Caddy получит его сам при первом запуске, если порты 80 и 443 доступны из интернета и DNS уже указывает сюда.
11. Снаружи открыть `https://app.swipe-music.site`. Проверить `GET /api/health`, вход, обновление страниц `/sources`, `/login`, `/reset-password` и сценарий Яндекса.

Caddy, файрвол, NAT и DNS из этого задания не настраиваются.

## Обновление после новых коммитов

На сервере, в `C:\SwipeMusic`:

```text
git status --short
git pull --ff-only
git rev-parse HEAD
npm ci
npm run build
```

`npm ci` нужен, когда изменились dependencies или lockfile. `npm run build` нужен, когда изменился frontend. Затем остановить прежний процесс backend и снова запустить `start-backend.ps1`. Базу и `secrets\` не удалять: `git pull` их не затирает. После старта повторить `test-backend.ps1`. Caddy перезагружать только если изменился Caddyfile. Новые файлы в `dist\` он читает с диска без нового сертификата.

## Production-переменные

Обязательные поля шаблона `deploy/windows/env.example`:

```text
NODE_ENV=production
PORT=8787
DATABASE_PATH=C:\SwipeMusic\data\swipemusic.sqlite
APP_PUBLIC_URL=https://app.swipe-music.site
MAIL_TRANSPORT=smtp
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
```

`PROVIDER_SESSION_KEY` в `production.env` не записывается. Ключ лежит только в `C:\SwipeMusic\secrets\provider-session.key`.
