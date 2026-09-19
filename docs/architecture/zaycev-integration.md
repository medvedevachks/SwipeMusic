# Zaycev.net — исследование и план интеграции (SOURCE-01)

Baseline: `8dbd530` (`feature/auth-01`). Ветка: `feature/zaycev-source-v1`.

## Аудит

| Область | Состояние |
|---|---|
| Frontend | React 19, Vite, Zustand, PWA |
| Backend / AUTH-01 | Hono + Better Auth + PostgreSQL + IndexedDB sync |
| Источники | `MusicSourceAdapter` + `MusicSourceRegistry`; зарегистрирован только `mock` |
| Track | `id = sourceId:externalId`; типа `SourceTrack` не было |
| Каталоги | `Category` + `TrackAssignment` (каталог = категория пользователя) |
| Sync | операции UUID; в item не было title/artist/URL |
| Docker | frontend, backend, db, migrate, mailpit |
| Zaycev | отсутствует |

AUTH-01 на этой ветке реализован (не заготовка). Отдельная система аккаунтов не создаётся.

## Исследование Zaycev.net

Проверено (сентябрь 2026):

- Сайт: https://zaycev.net/
- О сервисе: https://zaycev.net/spages/about.shtml
- Пользовательское соглашение: https://zaycev.net/spages/useragreement.shtml
- Инди-лейбл (не API): https://label.zaycev.net
- Поддержка: 911@zaycev.net

| Вопрос | Результат |
|---|---|
| Документированный API для сторонних приложений | **Не найден** |
| Программа для разработчиков / OAuth | **Не найдена** |
| Официальный SDK | **Нет** |
| Поиск / медиатека / метаданные через публичный API | **Не подтверждены** |
| Воспроизведение в стороннем плеере | **Не разрешено явно**; соглашение описывает воспроизведение **контента сайта**, не встраивание |
| Партнёрский доступ | Возможен только по отдельному соглашению с компанией |

В открытом доступе описан **неофициальный** `api.zaycev.net/external` (реверс Android-клиента, 2016). Это не документация для сторонних разработчиков. Использовать его запрещено ТЗ: парсинг внутренних API, перехват клиента, cookie, прямые аудиоссылки.

**Режим реализации: B** (ручные HTTPS-ссылки). Режим A не включается, пока нет письменной партнёрской документации и ключа.

## Модель

```
Track            — каноническая композиция в UI (`sourceId:externalId`)
SourceTrack      — запись конкретного источника (zaycev / mock / …)
Catalog          — пользовательский каталог = существующая Category
CatalogItem      — назначение SourceTrack в каталог = TrackAssignment
```

Одна песня с локального MP3 и с Zaycev.net — две SourceTrack. Автосклейка по названию **не выполняется**.

## Capabilities

Фактически у `zaycev` в режиме B:

| Capability | zaycev |
|---|---|
| search | нет |
| metadata | нет (только ручной ввод) |
| libraryImport | нет |
| librarySync | нет |
| playback | нет |
| externalOpen | **да** |

Заглушки не объявляются доступными.

## Хранение и sync

Расширение `collection_items`: title, artist, page_url, duration_ms, availability, playback_mode, position.

`kind: source_track` — карточка в библиотеке. `kind: assignment` — размещение в каталоге.

Изоляция: `user_id` только из сессии AUTH-01. Идемпотентность: PK операции + уникальность `(user, kind, track_id, category)`.

Если источник «отключён», записи остаются. Удаление трека на Zaycev.net само по себе не стирает каталог Swipe Music (`availability=unknown` до разрешённой проверки, которой нет).

## Воспроизведение

Встроенного Play нет. Кнопка: «Открыть в Zaycev.net» (`window.open` на пользовательский HTTPS URL после валидации). Backend **не** запрашивает этот URL.

## Будущий режим A

1. Получить партнёрский доступ и документацию.
2. Добавить секреты только в env (`ZAYCEV_PARTNER_KEY`), не в образ.
3. Расширить адаптер, не меняя UI каталогов.
4. Включать `search` / `playback` только после проверки реального API.
