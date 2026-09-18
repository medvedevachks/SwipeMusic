# Запуск Swipe Music в Docker

## Разница между контейнерами и volumes

| Команда | Что происходит с данными |
|---|---|
| `docker compose stop` | Контейнеры останавливаются. База на томе остаётся. |
| `docker compose down` | Контейнеры удаляются. **Именованный том `postgres_data` сохраняется.** |
| `docker compose down -v` | Контейнеры **и тома** удаляются. **База уничтожается.** Не использовать как штатную процедуру. |
| `docker compose up --build -d --force-recreate` | Пересоздание контейнеров **без** `-v` сохраняет PostgreSQL. |

Пересоздание контейнера без `-v` не должно приводить к потере коллекции.

Скрипт `docker/postgres/init/01-roles.sh` выполняется только при первом создании тома. Он создаёт роль приложения и базу `POSTGRES_TEST_DB`. Если том уже существует, скрипт не повторяется. Не используйте `down -v`, чтобы «переинициализировать» роли: это уничтожит данные. Добавляйте роль или тестовую базу SQL-командами в существующий том.

## Локальная разработка

1. Скопируйте `.env.example` в `.env` и задайте секреты.
2. `docker compose up --build -d`
3. Приложение: `http://localhost:5173`
4. Письма Mailpit: `http://localhost:8025`
5. API с браузера только через `/api` на том же origin.

Остановка: `docker compose down` (тома не трогать).

Логи: `docker compose logs --tail=100`

Миграции применяются сервисом `migrate` до старта backend. Повторный запуск безопасен.

## Тесты

```bash
docker compose --profile test run --rm backend-test
docker compose --profile test run --rm frontend-test
```

`backend-test` применяет миграции к изолированной базе `POSTGRES_TEST_DB` (`swipe_music_test` по умолчанию) и не пишет в `POSTGRES_DB`.

Playwright (полный стек уже запущен):

```bash
docker compose --profile e2e run --rm e2e
```

Если Docker недоступен, unit-тесты можно прогнать внутри контейнера после появления Docker; локальный Node.js не является требованием проекта.

## Резервное копирование PostgreSQL

```bash
docker compose exec db pg_dump -U "$POSTGRES_MIGRATE_USER" "$POSTGRES_DB" > backup.sql
```

Восстановление **в пустую или специально подготовленную** базу:

```bash
docker compose exec -T db psql -U "$POSTGRES_MIGRATE_USER" -d "$POSTGRES_DB" < backup.sql
```

Не восстанавливайте дамп поверх живых данных без отдельного решения.

## Production

```bash
docker compose -f compose.yaml -f compose.prod.yaml up --build -d
```

Перед этим:

- задайте `APP_ORIGIN` с HTTPS;
- задайте production SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`);
- поставьте reverse proxy с TLS перед `FRONTEND_PORT`;
- не публикуйте PostgreSQL и Mailpit;
- храните `.env` и секреты вне образа.

Пока production SMTP не задан, письма подтверждения и сброса пароля в публичном контуре не отправляются. В development их показывает Mailpit.

## Данные и 152-ФЗ

Пользовательские данные живут в томе PostgreSQL и в резервных копиях, которые делает оператор. Код не является юридическим заключением о соответствии 152-ФЗ. Размещение инфраструктуры в нужной юрисдикции — отдельное эксплуатационное решение.
