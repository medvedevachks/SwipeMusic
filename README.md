# Swipe Music

PWA для сортировки музыки жестами. Авторизация, подтверждение почты, сброс пароля и облачная синхронизация коллекции работают через Docker Compose. Локально Node.js, PostgreSQL и SMTP **не обязательны**.

## Требования

- Docker
- Docker Compose v2

## Быстрый старт

```bash
cp .env.example .env
# задайте POSTGRES_MIGRATE_PASSWORD и BETTER_AUTH_SECRET (≥ 32 символов)
docker compose up --build -d
```

- Приложение: http://localhost:5173
- Письма (Mailpit): http://localhost:8025
- API браузера: тот же origin, путь `/api`

Остановка контейнеров (данные БД сохраняются):

```bash
docker compose down
```

`docker compose down -v` удаляет том PostgreSQL и **уничтожает пользовательские данные**. Это не штатная команда обновления.

## Сборка и логи

```bash
docker compose build
docker compose ps
docker compose logs --tail=100
```

## Миграции

Сервис `migrate` применяет SQL из `backend/drizzle` до старта API. Повторный запуск идемпотентен. Backend не поднимается, пока миграции не завершились успешно.

## Тесты

```bash
docker compose --profile test run --rm backend-test
docker compose --profile test run --rm frontend-test
docker compose --profile e2e run --rm e2e
```

Backend-тесты идут в базу `swipe_music_test`, а не в рабочую `swipe_music`.

## Резервное копирование

См. [docs/deployment/docker.md](docs/deployment/docker.md).

## Production

```bash
docker compose -f compose.yaml -f compose.prod.yaml up --build -d
```

Нужны HTTPS reverse proxy, `APP_ORIGIN` с https, production SMTP. Mailpit в публичный контур не входит. Пока SMTP не задан, реальная отправка писем не настроена.

Архитектура AUTH-01: [docs/architecture/auth.md](docs/architecture/auth.md).
