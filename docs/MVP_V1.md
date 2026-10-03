# Swipe Music — MVP v1.0

Утверждённое продуктовое определение. Это цель MVP, не описание уже написанного кода. Фактическое состояние кода — в `GPT.md` и `docs/ROADMAP_MVP_V1.md`.

Baseline документации: ветка `main`, коммит `475fd34`.

## Product definition

**Swipe Music — универсальный музыкальный организатор, который объединяет музыку из разных источников в одной библиотеке и пользовательских каталогах. Воспроизведение происходит через доступный пользователю источник с учётом подключённых сервисов, подписок и локальных файлов.**

Swipe Music:

- не заменяет музыкальные сервисы;
- не даёт пользователю право слушать контент без необходимой подписки или доступа;
- организует музыку независимо от конкретного Provider;
- может знать несколько источников одной композиции;
- выбирает доступный источник воспроизведения;
- если источник недоступен — предлагает другой;
- если другого нет — предлагает подключить соответствующий сервис или оформить доступ в самом сервисе.

## MVP Sources

В MVP входят:

- Yandex Music
- VK Music
- Zaycev
- Local Files
- Spotify
- архитектура Provider для будущих сервисов

Готовность отдельных Providers может отличаться. На baseline `475fd34` рабочие контуры есть у demo (`mock`), local-folder, Spotify и Yandex (Device Flow). VK и Zaycev — заготовки.

## User Account

MVP должен иметь:

- registration
- login
- logout
- password recovery
- profile
- persistent account
- cross-device data sync

Первая разработка и тестирование — на одном реальном пользователе. Модель данных должна иметь `userId`.

На baseline аккаунта Swipe Music нет: нет backend, нет `userId`, нет регистрации.

## Unified Library

Одна библиотека Swipe Music поверх разных источников.

## Catalogs

Пользователь создаёт собственные каталоги, например:

- В машину
- Спорт
- Работа
- Любимое

Один каталог может содержать композиции из разных музыкальных сервисов и локальных файлов. Каталог принадлежит Swipe Music, а не Provider.

Сейчас в коде есть пресеты категорий («Любимое», «В машину» и другие) в памяти браузера. Это ещё не серверный каталог и не сущность, независимая от `sourceId` трека.

## Multi-source track

Целевая модель:

```text
Canonical Track
 ├─ Yandex copy
 ├─ VK copy
 ├─ Spotify copy
 ├─ Zaycev copy
 └─ Local copy
```

## Playback availability

Перед воспроизведением:

- source connected?
- auth valid?
- playback supported?
- user has access?
- track available?

Если первая копия недоступна — пробовать другую.

## Swipe

Существующая swipe-механика остаётся функцией категоризации.

## Search

Один Search UI по всем доступным источникам.

## Global Player

Постоянный плеер:

- play/pause
- next/previous
- seek
- volume
- shuffle
- repeat
- queue
- fallback
- errors

## Playback Context

Уже есть в коде:

- album
- playlist
- swipe
- search
- library

Целевой дополнительный контекст:

- catalog

## Car Mode

MVP должен иметь собственный touch-friendly Car Mode. Полноценная native-интеграция Android Auto и Apple CarPlay на этом этапе не требуется.

## Server persistence

Пользовательская организация должна переживать:

- logout/login
- смену браузера или устройства
- отключение Provider
- недоступность Provider

## Не входит в MVP

- AI recommendation engine
- social network
- public profiles
- comments
- Swipe Music subscription billing
- family accounts
- собственный music CDN
- full Android Auto
- full Apple CarPlay
- native desktop application
- BPM/key analysis
- обогащение MusicBrainz/Discogs
