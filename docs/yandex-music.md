# Яндекс Музыка

> **Устарело (MVP-00, `main` @ `475fd34`).** Этот файл описывает stub «вариант A». Фактический код — experimental Device Flow и внутренний API в `src/sources/adapters/yandex-music/`. Ручной user token в рабочем дереве отсутствует. Актуальный снимок: `GPT.md`.

## Статус интеграции: вариант A (stub)

Официального публичного API для сторонних приложений **нет**.

| Функция | Статус |
|---------|--------|
| OAuth / Connect | Недоступно официально |
| SearchProvider | Не регистрируется |
| LibraryProvider | Не регистрируется |
| Playback / stream | Кандидаты `available: false` |
| Неофициальный API | Не подключён |

Код: `src/sources/adapters/yandex-music/`.

На `/sources` панель строится только через `AuthenticationProvider.getStatus()`.

В DEV: `Dev · Yandex Music Log`.
