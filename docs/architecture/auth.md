# AUTH-01 — архитектура авторизации и синхронизации коллекции

Baseline: `8a6c05d` (`develop`). Ветка реализации: `feature/auth-01`.

## Аудит на момент старта

| Область | Состояние |
|---|---|
| Стек | React 19, TypeScript, Vite 8, Zustand, Tailwind 4, vite-plugin-pwa |
| Docker | отсутствует |
| Backend | отсутствует |
| Track / Category | `src/types/track.ts`, `src/types/category.ts` |
| Store | `src/store/collectionStore.ts` — только память, без persist |
| Источники | реестр адаптеров, активен mock |
| PWA | `vite-plugin-pwa`, `registerSW` в `main.tsx` |
| Авторизация | нет |
| Тесты | нет |
| Хранение | нет IndexedDB, нет сервера |

Существующий UI, жесты и источники **не переписываются**. Добавляются backend, Docker, страницы кабинета и слой синхронизации вокруг текущего store.

## Принцип Docker-first

Локальный запуск: `docker compose up --build -d`.

| Сервис | Публичный адрес | Внутренний адрес |
|---|---|---|
| frontend (Vite / nginx) | `localhost:${FRONTEND_PORT}` | `frontend:5173` или `frontend:80` |
| backend | только через frontend `/api` | `backend:3000` |
| PostgreSQL | не публикуется | `db:5432` |
| Mailpit UI | `localhost:${MAILPIT_UI_PORT}` (только dev) | `mailpit:8025` |
| SMTP | не публикуется | `mailpit:1025` |

Браузер никогда не обращается к Docker DNS-именам. Контейнеры не используют `localhost` и `host.docker.internal` для связи друг с другом.

PostgreSQL: роль миграций (`POSTGRES_MIGRATE_USER`) создаёт схему; приложение подключается ролью `POSTGRES_APP_USER` с правами DML. Тесты используют отдельную базу `POSTGRES_TEST_DB` на том же экземпляре, без изменения `POSTGRES_DB`.

## Выбор стека backend

- **Hono** + `@hono/node-server` — минимальный TypeScript HTTP-сервер, совместимый с Vite/ESM.
- **Better Auth** — проверенная библиотека email/password, сессии в HttpOnly cookie, верификация почты, сброс пароля, хеширование паролей. Данные остаются в нашем PostgreSQL (не SaaS за пределами контура).
- **Drizzle ORM** + SQL-миграции — без destructive schema sync.
- **Nodemailer** — SMTP из переменных окружения; в development — Mailpit.

Сторонняя облачная IdP-платформа не используется.

## Сервисы

```
Browser / PWA
    │  APP_ORIGIN (например http://localhost:5173)
    ▼
frontend  ── /api/* ──►  backend:3000
                           │
                           ├─ db:5432
                           └─ mailpit:1025  (только development)
```

Production: тот же backend, frontend отдаёт статику через nginx, SPA fallback, HTTPS на reverse proxy перед стеком. Mailpit в production-контур не входит.

## Пользовательские данные

### Better Auth

Таблицы `user`, `session`, `account`, `verification` (и rate-limit, если включено в адаптере).

Дополнительные поля пользователя: `first_name`, `last_name`. Email нормализуется: `trim + lowercase`.

Пароли хранятся только как хеш Better Auth. Токены подтверждения и сброса — одноразовые, с TTL, в БД в виде значения verification (не логируются).

### Прикладные таблицы

Все строки привязаны к `user_id` из проверенной сессии. `user_id` из тела запроса игнорируется.

| Таблица | Назначение |
|---|---|
| `profiles` | денормализованный снимок профиля для кабинета |
| `categories` | пользовательские категории |
| `collection_items` | лайки и назначения трек→категория |
| `track_decisions` | история сортировки (like / skip / categorize) |
| `user_settings` | жесты и прогресс сессии |
| `sync_operations` | идемпотентный журнал операций |

Идентификатор трека канонический: `${sourceId}:${externalId}` — коллизии между источниками исключены.

## Локальное хранение и синхронизация

1. Zustand остаётся UI-состоянием.
2. IndexedDB (`swipe-music-collection`) — источник локальной правды и очередь pending-операций.
3. Перед импортом создаётся резервная копия в IndexedDB.
4. Каждая мутация получает UUID операции.
5. Клиент шлёт `POST /api/sync/operations`; повтор с тем же id не создаёт дубликат (PK).
6. После login: `GET /api/sync/snapshot`, затем merge.
7. Пустой локальный снимок **не** перезаписывает непустую серверную коллекцию.
8. Конфликт: last-write-wins по `updated_at`; мягкое удаление побеждает, если `deleted_at` новее.

Статусы UI: локально → синхронизация → в облаке / ошибка. «В облаке» только после подтверждения сервера.

## Безопасность

- Сессия: HttpOnly cookie, `SameSite=Lax`, `Secure` при HTTPS.
- CSRF: same-origin через reverse proxy + SameSite.
- Rate limit: вход и повтор писем.
- Изоляция: все SQL-запросы фильтруются `user_id` сессии.
- Секреты: только env / Docker secrets, не в образе.
- Процессы production: non-root.
- PostgreSQL и Mailpit не публикуются наружу в production.
- 152-ФЗ: код даёт техническую основу (минимизация ПДн, удаление аккаунта, изоляция, резервное копирование). Юридическое соответствие отдельным аудитом **не** заявляется.

Физическое размещение ПДн, бэкапов и логов в production задаёт оператор (хостинг в РФ — требование эксплуатации, не код).

## Миграции

Сервис `migrate` в Compose применяет SQL из `backend/drizzle` под advisory lock. Backend стартует только после успешного `service_completed_successfully`. Повторный запуск идемпотентен. `docker compose down -v` уничтожает данные и **не** является штатной командой обновления.
