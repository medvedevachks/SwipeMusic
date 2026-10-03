# ROADMAP MVP v1.0

Статусы сняты с кода ветки `main`, коммит `475fd34`. Это не старый план и не обещание, что следующий этап уже начат.

| Этап | Статус | Почему |
|---|---|---|
| 0. Baseline | DONE | HEAD = `origin/main` = `475fd34`. Архитектура, Providers, persistence и Yandex сверены с кодом. `GPT.md`, этот файл и `docs/MVP_V1.md` зафиксированы. |
| 1. User Account | DONE | Регистрация, вход, HttpOnly-сессия, выход, восстановление пароля. |
| 2. Server Persistence | DONE | MVP-02A и MVP-02B: после входа frontend читает и пишет категории, коллекцию, лайки, назначения, историю и `gestureConfig` через `/api/me/*`. SQLite переживает reload, logout/login и перезапуск backend. |
| 3. Universal Catalogs | PARTIAL | Есть `Category` и пресеты («Любимое», «В машину»). Один трек может быть в нескольких категориях. Организация переживает reload, но ключ по-прежнему `trackId` источника. |
| 4. Canonical Track + Source Copies | PARTIAL | `MediaIndex` умеет `TrackRecord.copies` и ключ дедупликации. Рабочий `Track.id` — это `${sourceId}:${externalId}`. Коллекция пользователя ключуется этим id. |
| 5. Playback Availability | PARTIAL | `PlaybackResolver` собирает кандидатов, смотрит `available`, priority и `requiresPremium`. Отдельного продуктового чеклиста доступа нет. |
| 6. Alternative Source / Subscription UX | PARTIAL | Есть текст ошибки и fallback на preview внутри одного Provider. Нет сценария «подключите сервис / оформите доступ». |
| 7. Yandex stabilization | PARTIAL | Device Flow, поиск, чтение лайков и плейлистов, кандидаты стрима есть в коде. Live не подтверждался. Refresh token не используется. Ручного user token нет. |
| 8. Local Music stabilization | PARTIAL | Выбор папки, скан, IndexedDB handle, поиск и локальное воспроизведение реализованы. Отдельной стабилизации и QA нет. |
| 9. Spotify verification | PARTIAL | OAuth PKCE, поиск, sync, preview и Web Playback SDK есть в коде. Нужен `VITE_SPOTIFY_CLIENT_ID`. В этой сессии аккаунт не проверялся. |
| 10. VK Provider | TODO | `VKMusicAdapter` — пустая заготовка `ApiMusicAdapter`. `isAvailable()` возвращает false. |
| 11. Zaycev Provider | TODO | Парсеры поиска и трека возвращают пусто. `parseStream` бросает «not implemented». |
| 12. Unified Library | PARTIAL | Экран `/library` читает индекс и провайдеров. Единой пользовательской библиотеки поверх всех копий ещё нет. |
| 13. Unified Search | PARTIAL | `SearchEngine` мержит активные адаптеры в один UI `/search`. Неподключённые и пустые адаптеры результата не дают. |
| 14. Catalog Playback Context | TODO | `PlaybackContext` не содержит `catalog`. Слово catalog в свайп-колоде означает режим демо-ленты, не пользовательский каталог. |
| 15. Queue improvements | PARTIAL | Очередь, shuffle, repeat, persist и блокировка album/playlist есть. Контекста каталога и явного cross-provider fallback в очереди нет. |
| 16. Cross-device sync | TODO | Клиент читает и пишет библиотеку при входе и reload. Живой синхронизации, conflict resolution и offline queue нет. |
| 17. Car Mode | TODO | Есть иконка категории «В машину». Экрана Car Mode нет. |
| 18. PWA / resilience | PARTIAL | `vite-plugin-pwa`, service worker и IndexedDB-индекс есть. Офлайн-устойчивость всего MVP не проверена. |
| 19. MVP QA | TODO | `npm test` покрывает auth, server persistence и frontend library bootstrap. Остальной UI без тестового фреймворка. |

Подэтапы User Account:

```text
MVP-01A Account backend + sessions = DONE
MVP-01B Password recovery = DONE
MVP-01 User Account = DONE
MVP-02 Server Persistence = DONE
MVP-02A Server data model + authenticated API = DONE
MVP-02B Frontend stores → server = DONE
```

Следующий этап: MVP-03, Universal Catalogs.
