# Swipe Music на Windows Server 2019

Этот каталог описывает будущий запуск. Он ничего не устанавливает и не настраивает сервер.

Docker не используется. Backend слушает только `127.0.0.1:8787`. Порт 8787 не пробрасывается в интернет и не открывается в файрволе наружу.

```text
Internet
→ NAT 80/443
→ Windows Server
→ Caddy
   ├─ статический C:\SwipeMusic\dist
   └─ /api/* → 127.0.0.1:8787
→ Node backend
→ SQLite / Yandex
```

Production-процесс — `node --experimental-strip-types server/index.ts`. Для этого нужен Node.js 22 или новее; на DEV проверен Node 22.23.3. Этот процесс не запускает Vite и не раздаёт файлы репозитория. Пример Caddy отдаёт только `C:\SwipeMusic\dist`. Живой Caddyfile на сервере этим репозиторием не проверяется.

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

`APP_PUBLIC_URL` должен быть публичным HTTPS-адресом, с которого пользователь открывает сайт. Ссылки сброса пароля собираются из него.

## Яндекс

Сессия Яндекса остаётся на backend в зашифрованном виде. Браузер не получает сохранённый token обратно и не хранит его в `localStorage`.

`/api/yandex-oauth/device/code` и `/api/yandex-oauth/token` проксируют только эти два шага Device Flow на `https://oauth.yandex.ru`. Нужна сессия Swipe Music.

`/api/yandex-fetch` нужен только для XML download-info. Разрешён один HTTPS-хост: `storage.mds.yandex.net`. Локальные, частные и link-local адреса отклоняются. Редирект на запрещённый хост не выполняется. Cookie и Authorization браузера на upstream не уходят.

## Запуск backend

Секреты лежат вне Git, в `C:\SwipeMusic\secrets`.

Сначала проверка, затем запуск. `preflight.ps1` только читает базу, окружение, ключ, сборку, порт и git status. Он не пишет файлы, не ставит службы и не трогает Caddy. Пароль SMTP, `PROVIDER_SESSION_KEY` и содержимое `provider-session.key` не печатаются.

Проверка дополнительно требует, чтобы `DATABASE_PATH` после нормализации абсолютного Windows-пути совпал с `C:\SwipeMusic\data\swipemusic.sqlite`, `PORT` был целым `8787`, а `MAIL_TRANSPORT` оставался `smtp`. `APP_PUBLIC_URL` должен быть абсолютным `https` без query, fragment, localhost и `127.0.0.1`; подходит и домен, и IP. Реальный публичный адрес в репозиторий не записывается. Строка `PROVIDER_SESSION_KEY` в `production.env` запрещена: ключ читается только из `provider-session.key`. Рядом должен лежать `deploy/windows/start-backend.ps1`. Git должен игнорировать `data/swipemusic.sqlite`, `secrets/provider-session.key` и `secrets/production.env`.

```text
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\preflight.ps1

powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\start-backend.ps1
```

Пока SMTP не заполнен, первая команда сообщает `PRE-FLIGHT: NOT READY`. Это ожидаемый результат, а не аварийный след. Когда SMTP заполнен и остальные проверки проходят, она сообщает `PRE-FLIGHT: READY`. Backend запускают после READY.

`start-backend.ps1` находит корень репозитория относительно себя, загружает `production.env`, проверяет, что ключ — это canonical base64 на 32 байта, и запускает каноническую команду `node --experimental-strip-types server/index.ts`. Backend по-прежнему слушает только `127.0.0.1`. Пути к секретам можно переопределить параметрами `-EnvFile` и `-ProviderKeyFile`.

## Канонический порядок

Tracked-код на production вручную не редактируется. `data\` и `secrets\` не проходят через Git. Порт 8787 наружу не публикуется. Backend слушает только `127.0.0.1:8787`. SMTP-провайдер задаётся только переменными `SMTP_*`. Gmail, Brevo и любой другой совместимый relay не требуют правок application code.

Production backend считается готовым только после трёх результатов:

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

## Сертификат Let's Encrypt на IP

Команды ниже оператор запускает на Windows Server позже. Этот шаг репозитория их не выполняет: Posh-ACME не ставится, сертификат не запрашивается, firewall и NAT не меняются, Caddy не устанавливается и не перезагружается.

Нужен Posh-ACME не ниже 4.31.1. IP-сертификат Let's Encrypt запрашивается только с профилем `shortlived` и плагином `WebSelfHost` на стандартном порту 80. Реальный публичный IP в Git не записывается. Самоподписанные сертификаты и локальный CA Caddy не используются.

Пока идёт проверка HTTP-01, внешний TCP 80 должен быть доступен из интернета на этот сервер. Скрипты сами правило firewall и проброс NAT не создают. Если порт 80 уже занят, запрос останавливается и не останавливает IIS или Caddy. Для http.sys без прав администратора может понадобиться URL reservation на `http://+:80/.well-known/acme-challenge/`; скрипт её не создаёт.

```text
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\install-poshacme.ps1

powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\check-acme-readiness.ps1

powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\request-ip-certificate.ps1 -PublicIp <PUBLIC_IP> -Staging

powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\request-ip-certificate.ps1 -PublicIp <PUBLIC_IP>
```

Сначала staging (`LE_STAGE`), затем production (`LE_PROD`). Проверка готовности ничего не создаёт. Если каталога `C:\SwipeMusic\secrets\certs` ещё нет, она пишет `[WAIT]` и `ACME PRE-FLIGHT: NOT READY`. После успешного запроса скрипт кладёт только `fullchain.pem` и `privkey.pem` в этот каталог и не печатает закрытый ключ. Каталог внутри `secrets\` и в Git не входит. Эти два файла позже подставляются вместо `<CERT_FILE>` и `<KEY_FILE>`.

## Порядок запуска

Команды выполняет оператор на сервере, не этот репозиторный шаг.

1. Получить нужную ветку или релиз: `git checkout <deployment-branch-or-release>`.
2. Установить зависимости: `npm ci`.
3. Записать окружение и секреты вне Git, в `C:\SwipeMusic\secrets`, по `deploy/windows/env.example`. Туда же положить `provider-session.key`. Эти файлы не коммитить.
4. Собрать frontend: `npm run build`. Результат — `dist\`.
5. Проверить готовность и только потом запустить backend. Процесс слушает `127.0.0.1:8787`.

```text
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\preflight.ps1

powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\start-backend.ps1
```

Пока первая команда печатает `PRE-FLIGHT: NOT READY`, backend не запускать. После заполнения SMTP ожидается `PRE-FLIGHT: READY`.
6. Проверить запущенный backend и SMTP. Backend должен слушать только `127.0.0.1:8787`.

```text
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\test-backend.ps1

powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\test-smtp.ps1
```

Ожидаются `BACKEND SMOKE TEST: PASS` и, для команды без `-SendTest`, `SMTP DIAGNOSTIC: PASS`. Это ещё не подтверждение SMTP. Финальный результат `SMTP TEST: PASS` даёт только реальная отправка:

```text
powershell -ExecutionPolicy Bypass -File C:\SwipeMusic\deploy\windows\test-smtp.ps1 -SendTest -To <email>
```
7. Поставить Caddy и взять за основу `deploy/windows/Caddyfile.example`. В Caddyfile путь `C:/SwipeMusic/dist` — это `C:\SwipeMusic\dist`. Caddy не запускать, пока не получен IP-сертификат: на время HTTP-01 порт 80 нужен WebSelfHost.
8. Подставить `C:\SwipeMusic\secrets\certs\fullchain.pem` и `privkey.pem` вместо `<CERT_FILE>` и `<KEY_FILE>`. Как их получить, описано выше; этот шаг репозитория сертификат не запрашивает. Закрытый ключ не класть в `dist\` и не коммитить.
9. Настроить NAT только для портов 80 и 443 на этот Windows Server. Порт 8787 не публиковать.
10. Снаружи открыть `https://<PUBLIC_IP>`, проверить вход, обновление страниц `/sources`, `/login`, `/reset-password` и сценарий Яндекса.

Caddy из этого задания не запускается. Файрвол, NAT и боевой сертификат здесь не настраиваются.
