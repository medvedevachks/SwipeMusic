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

В development Vite только пересылает `/api/*` на тот же backend. Отдельного Vite-прокси для Яндекса больше нет.

## Каталоги

Сборка и постоянные данные разделены. Повторный `npm run build` заменяет `dist\` и не удаляет базу, ключ шифрования и сертификаты.

```text
C:\SwipeMusic\
    dist\          собранный frontend/PWA
    server\        код backend
    data\
        swipemusic.sqlite
    deploy\
        windows\
```

База, `PROVIDER_SESSION_KEY` и закрытые ключи сертификатов не кладутся в `dist\`.

## Секреты

Шаблон переменных: `deploy/windows/env.example`.

Ключ сессии провайдера, 32 байта, base64:

```text
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Напечатанное значение — секрет. Его нельзя коммитить, писать в логи и класть в `dist\`.

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

## Порядок запуска

Команды выполняет оператор на сервере, не этот репозиторный шаг.

1. Получить нужную ветку или релиз: `git checkout <deployment-branch-or-release>`.
2. Установить зависимости: `npm ci`.
3. Записать окружение и секреты по `deploy/windows/env.example`. Файл с секретами не коммитить.
4. Собрать frontend: `npm run build`. Результат — `dist\`.
5. Запустить backend: `npm run start:server`. Процесс слушает `127.0.0.1:8787`.
6. Проверить локально: `http://127.0.0.1:8787/api/health` отвечает `{"ok":true}`.
7. Поставить Caddy и взять за основу `deploy/windows/Caddyfile.example`. В Caddyfile путь `C:/SwipeMusic/dist` — это `C:\SwipeMusic\dist`.
8. Подставить свои файлы HTTPS-сертификата вместо `<CERT_FILE>` и `<KEY_FILE>`. Закрытый ключ не класть в `dist\` и не коммитить.
9. Настроить NAT только для портов 80 и 443 на этот Windows Server. Порт 8787 не публиковать.
10. Снаружи открыть `https://<PUBLIC_IP>`, проверить вход, обновление страниц `/sources`, `/login`, `/reset-password` и сценарий Яндекса.

Caddy из этого задания не запускается. Файрвол, NAT и боевой сертификат здесь не настраиваются.
