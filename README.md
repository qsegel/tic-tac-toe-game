# Крестики-нолики онлайн

Игра 1 на 1 в реальном времени: Vue 3 на клиенте, Node.js + Fastify на сервере.
Можно играть из аккаунта или гостем. Аккаунты, завершённые партии и статистика
хранятся в SQLite, сами комнаты — в памяти процесса.

```
┌────────────┐   HTTP (auth/create/join)   ┌──────────────────┐
│  Vue 3 SPA │ ──────────────────────────► │   Fastify API    │
│  Pinia     │ ◄────────────────────────── │  RoomRegistry    │
│            │   WebSocket (state)         │  (in-memory)     │
└────────────┘                             └────────┬─────────┘
                                                    │
                                           ┌────────▼─────────┐
                                           │ SQLite: users,   │
                                           │ matches          │
                                           └──────────────────┘
```

## Что умеет

- **Аккаунты** — регистрация по email, паролю и отображаемому имени. Пароли хешируются `scrypt`.
- **Гости** — можно играть без регистрации; история и статистика для гостей не сохраняются.
- **JWT-сессия в httpOnly cookie** — срок жизни 24 часа, без refresh-токенов. Cookie `ttt_session`, `SameSite=Lax`, `Secure` за HTTPS.
- **Комната на двоих** — 6-символьный код без похожих символов (`0/O`, `1/I/L`), ссылка-инвайт, вход по коду.
- **Сервер — арбитр.** Клиент не решает, чей ход и кто победил; любой ход проверяется на сервере.
- **Защита от гонок** — у состояния есть `version`, устаревший или повторный ход отклоняется (`STALE_STATE`).
- **Переподключение** — обрыв связи даёт 30 секунд; вернувшийся игрок попадает в ту же партию, иначе партия помечается `abandoned` с победой оставшегося. Если не осталось никого, победа не присуждается.
- **Живость соединений** — сервер сам пингует сокеты и закрывает «мёртвые».
- **Рематч** — оба голосуют, доска очищается, метки меняются (`X ↔ O`), номер раунда увеличивается.
- **История и статистика** — каждый завершённый раунд — отдельный матч; победы, поражения, ничьи и брошенные партии считаются отдельно.
- **Валидация и лимиты** — JSON-схемы Fastify, единый формат ошибок, rate limit на HTTP и WS, лимит сокетов с одного IP и комнат в памяти, проверка `Origin` + CSRF-защита.
- **UI** — тёмная адаптивная тема, подсветка выигрышной линии, баннеры «нет связи», клавиатурная навигация, `aria-live` для статуса, `prefers-reduced-motion`.

## Стек

| Слой | Технологии |
|---|---|
| Клиент | Vue 3 (`<script setup>`), TypeScript, Pinia, Vue Router, Vite |
| Сервер | Node.js, Fastify 5, `@fastify/jwt`, `@fastify/cookie`, `@fastify/websocket`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/static` |
| БД | встроенный `node:sqlite` (`DatabaseSync`), WAL, миграции через `PRAGMA user_version` |
| Общее | `packages/shared` — правила игры и типы протокола (чистый TS, без зависимостей) |
| Тесты | `node:test` + `tsx` (shared/server), Vitest + Vue Test Utils (client) |

## Быстрый старт

Требуется **Node.js ≥ 22.13** (нужен `node:sqlite` без флага; на Node 24 всё тоже работает).

```bash
npm install
npm run dev
```

- клиент: <http://localhost:5173>
- сервер: <http://localhost:3000> (Vite проксирует `/api` и `/ws`)

Откройте две вкладки (или обычное окно + инкогнито), зарегистрируйте двух
пользователей (либо одного пользователя и гостя) и создайте комнату. Второй
игрок открывает ссылку из комнаты.

> Гостевая cookie общая на все вкладки одного браузера. Чтобы сыграть двумя
> гостями, используйте второй браузер или окно инкогнито.

### Прод-режим (один origin)

```bash
npm run build
JWT_SECRET="$(openssl rand -hex 32)" npm start
# http://localhost:3000 — Fastify отдаёт собранный клиент, API и WS
```

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | сервер (`tsx watch`) + клиент (`vite`) одновременно |
| `npm run build` | типы + сборка клиента в `apps/client/dist` |
| `npm start` | прод-сервер: API, WS, статика и SQLite на одном порту |
| `npm test` | тесты всех пакетов |
| `npm run typecheck` | `tsc`/`vue-tsc` без эмита |

## Структура

```
.
├─ packages/shared/          # домен и протокол, общие для клиента и сервера
│  ├─ src/game.ts            # createGame, joinGame, applyMove, startRematch, checkWinner
│  ├─ src/types.ts           # Game, PublicGame, GameError, коды ошибок
│  ├─ src/protocol.ts        # типы WS-сообщений, auth и history
│  └─ test/game.test.ts      # тесты правил
├─ apps/server/
│  ├─ src/app.ts             # сборка Fastify (используется и в тестах)
│  ├─ src/auth/              # пароли, пользователи, JWT/cookie, auth-роуты
│  ├─ src/db.ts              # SQLite + миграции
│  ├─ src/history.ts         # запись матчей, статистика, история
│  ├─ src/profile.ts         # GET /api/me/stats, /api/me/matches
│  ├─ src/errors.ts          # HTTP-статусы и единый формат ошибок
│  ├─ src/rooms.ts           # RoomRegistry: комнаты, таймеры, TTL
│  ├─ src/routes.ts          # игровые HTTP-эндпоинты
│  ├─ src/ws.ts              # /ws: cookie-авторизация, heartbeat, лимиты
│  ├─ src/index.ts           # bootstrap + graceful shutdown
│  ├─ test/api.test.ts       # интеграционные тесты HTTP + WebSocket
│  ├─ test/auth.test.ts      # регистрация, вход, гость, CSRF
│  ├─ test/history.test.ts   # матчи, abandoned, рематчи, статистика
│  └─ test/logging.test.ts   # редакция секретов в логах
└─ apps/client/
   ├─ src/stores/auth.ts     # Pinia: текущий пользователь и вход
   ├─ src/stores/game.ts     # Pinia: состояние, сокет, реконнект с backoff
   ├─ src/lib/api.ts         # HTTP-клиент (credentials: include)
   ├─ src/lib/session.ts     # игровая сессия (sessionStorage) и имя (localStorage)
   ├─ src/lib/status.ts      # тексты/тональность статуса
   ├─ src/views/             # HomeView, GameView, AuthView, ProfileView
   └─ src/components/        # GameBoard, PlayerCard, ConnectionBanner, ui/*
```

## Конфигурация

Сервер читает переменные окружения (и `apps/server/.env`, если файл есть — см. `apps/server/.env.example`):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3000` | порт HTTP/WS |
| `HOST` | `0.0.0.0` | интерфейс |
| `CLIENT_ORIGIN` | пусто | белый список origin через запятую для CORS, проверки `Origin` у WS и CSRF; пусто = CORS выключен, Origin у WS не проверяется (только для локальной разработки) |
| `JWT_SECRET` | случайный | секрет подписи JWT. В проде задайте явно (≥ 32 символов), иначе после рестарта сессии инвалидируются |
| `COOKIE_SECURE` | `false` | всегда ставить cookie с флагом `Secure` (за HTTPS reverse-proxy) |
| `DATABASE_PATH` | `apps/server/data/ttt.db` | путь к SQLite-базе |
| `TRUST_PROXY` | `false` | доверять `X-Forwarded-*`; включайте только за reverse-proxy |
| `MAX_ROOMS` | `10000` | максимум комнат в памяти; при переполнении создание отвечает `503 ROOM_LIMIT` |
| `MAX_SOCKETS_PER_IP` | `8` | максимум одновременных WS-соединений с одного IP |
| `ROOM_TTL_MS` | `600000` | через сколько удаляется комната, в которой не осталось подключённых игроков |
| `STATIC_DIR` | `apps/client/dist` | каталог собранного клиента |

Клиент: `VITE_API_URL` (по умолчанию пусто = тот же origin) и `VITE_WS_URL`
(по умолчанию выводится из API/текущего origin). Игровая сессия хранится в
`sessionStorage` (у каждой вкладки своя партия), имя гостя — в `localStorage`,
а личность пользователя — в httpOnly cookie.

## Аккаунты и сессии

- JWT HS256, claims: `sub`, `role: user | guest`, `iss: ttt`, `aud: ttt-web`, `exp` — 24 часа.
- Cookie `ttt_session`: `httpOnly`, `SameSite=Lax`, `path=/`, `Max-Age=86400`; `Secure` при `COOKIE_SECURE=true` или HTTPS.
- Пароли: `scrypt` (`N=16384, r=8, p=1`, 64 байта) + `timingSafeEqual`; одинаковое время ответа для «нет такого email» и «неверный пароль».
- Гость получает `role=guest` и `playerId` вида `guest_…`; аккаунт — `usr_…`.
- Выход только очищает cookie: JWT остаётся валидным до `exp` (отзыва токенов нет — осознанное упрощение).
- CSRF: `SameSite=Lax` + проверка `Origin` для `POST/PUT/PATCH/DELETE` на `/api/*`, если задан `CLIENT_ORIGIN`.
- Rate limit: регистрация 5/мин, вход 10/мин, гость 20/мин, `/api/auth/me` 120/мин.

## HTTP API

Все игровые эндпоинты и `/api/auth/me` требуют cookie сессии.

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| `POST` | `/api/auth/register` | `{ email, password, name }` | `201 { user }` + `Set-Cookie` |
| `POST` | `/api/auth/login` | `{ email, password }` | `200 { user }` + `Set-Cookie` |
| `POST` | `/api/auth/guest` | `{ name }` | `200 { user }` + `Set-Cookie` |
| `POST` | `/api/auth/logout` | — | `204`, cookie очищается |
| `GET` | `/api/auth/me` | — | `200 { user }` |
| `POST` | `/api/games` | — | `201 { gameId, code, playerId, mark: "X" }` |
| `POST` | `/api/games/:code/join` | — | `201 { gameId, code, playerId, mark: "O" }` |
| `GET` | `/api/games/:code` | — | `200 { game: PublicGame }` |
| `GET` | `/api/me/stats` | — | `200 { wins, losses, draws, abandoned, played }` |
| `GET` | `/api/me/matches?limit=20&offset=0` | — | `200 { matches, total, hasMore }` |
| `GET` | `/health` | — | `200 { ok: true }` |

`user`: `{ id, email, name, guest, createdAt }`; у гостя `email: null`, `guest: true`.
`/api/me/stats` и `/api/me/matches` для гостя отвечают `403 ACCOUNT_REQUIRED`.

Ошибки: `{ code, message }`, где `code` — машинный (`UNAUTHORIZED`, `INVALID_CREDENTIALS`,
`EMAIL_TAKEN`, `ACCOUNT_REQUIRED`, `ROOM_FULL`, `RATE_LIMITED`, …). Ошибки валидации
Fastify и rate limit также приводятся к этому формату. `playerId` в публичный
снапшот не попадает.

## История и статистика

- В SQLite сохраняются только партии, где есть хотя бы один зарегистрированный игрок; матч двух гостей не записывается.
- Каждый завершённый раунд — отдельная запись; рематч создаёт новый матч с `round + 1`.
- `finished`: победитель получает `win`, проигравший — `loss`, при ничьей оба получают `draw`.
- `abandoned`: оставшийся в игре получает `win`, ушедший — `abandoned`. Если ушли оба, оба получают `abandoned`.
- `played = wins + losses + draws + abandoned`.
- Повторная запись того же раунда игнорируется (`UNIQUE (game_id, round)`).

## WebSocket

Подключение: `ws(s)://<host>/ws?code=<roomCode>`, авторизация — по cookie `ttt_session`.
Нет/невалидная cookie → закрытие с кодом `1008` и reason `unauthorized`.
Новый сокет того же игрока вытесняет старый (`4001`).

Клиент → сервер:

```json
{ "type": "move", "gameId": "…", "index": 4, "version": 3 }
{ "type": "rematch" }
{ "type": "leave" }
{ "type": "ping" }
```

Сервер → клиент:

```json
{ "type": "state", "game": { "...": "PublicGame" }, "you": "X" }
{ "type": "error", "code": "NOT_YOUR_TURN", "message": "Сейчас ход соперника" }
{ "type": "pong" }
```

Решения, которые стоит знать:

- **Полный снапшот вместо диффов.** На 9 клетках экономить нечего, зато невозможен рассинхрон.
- **`version` обязателен в ходе.** Двойной клик или два таба не «перескочат» ход.
- **`you` приходит в каждом `state`.** После рематча метки меняются, и клиент узнаёт об этом из снапшота.
- **Состояние `abandoned`** приходит и при явном выходе, и по истечении grace-периода.
- **Лимиты** — 10 ходов/с, 30 любых сообщений/с на сокет, 8 сокетов с одного IP, 4 КБ на сообщение.
- **Heartbeat** — сервер пингует сокеты раз в 30 секунд и закрывает не отвечающие.

## Правила и граничные случаи

- Поле 3×3, побеждают 8 линий; `X` всегда ходит первым; создатель комнаты получает `X`.
- Партия стартует, когда второй игрок вошёл в комнату; если он так и не открыл сокет, через grace-период партия отменяется.
- Нельзя: ходить не в свой ход, в занятую клетку, после финала, с чужим `version`, третьим игроком, с индексом вне `0..8`.
- Третий игрок получает `ROOM_FULL`; вход в несуществующую комнату — `NOT_FOUND`.
- Обрыв связи: 30 с на возврат, затем `abandoned` (победитель — оставшийся в сети игрок).
- Оба ушли — комната отменяется без победителя.
- Комната удаляется через `ROOM_TTL_MS` (по умолчанию 10 минут) после того, как в ней не осталось подключённых игроков.
- Лимиты: 30 созданий/входов в минуту, 120 чтений комнаты в минуту, 10 ходов/с и 30 сообщений/с на сокет, 8 сокетов с IP, не больше `MAX_ROOMS` комнат.
- Имя: 1–20 символов, пробелы схлопываются, управляющие символы вырезаются.
- Доска блокируется, пока ход соперника или нет соединения.

## Тесты

```bash
npm test
```

- `packages/shared` — 24 теста: все выигрышные линии, ничья, очередность, занятые клетки, версии, рематч со сменой меток и раунда, санитайзинг имён, отсутствие утечки `playerId`.
- `apps/server` — 38 тестов: полная партия, auth (регистрация/вход/гость/logout/CSRF), история (победа/ничья/abandoned/рематчи/гости/пагинация), `ROOM_FULL`, `ROOM_LIMIT`, ошибки ходов, отмена по grace-таймеру, уход обоих, реконнект, cookie/WS-авторизация, `Origin`, лимиты HTTP/WS, sweep.
- `apps/client` — 63 теста: тексты статусов, компоненты UI и доски, Pinia-сторы auth и game (создание игры, снапшоты, защита от двойного клика, смена меток, восстановление сессии, 401).

## Docker

```bash
docker compose up --build
# http://localhost:3000
```

`Dockerfile` — multi-stage: сборка клиента → рантайм с прод-зависимостями.
Контейнер работает от пользователя `node`, у сервиса есть `HEALTHCHECK` на `/health`.
SQLite лежит в named volume `ttt-data` (`/app/apps/server/data`), поэтому история
переживает перезапуск контейнера. В `docker-compose.yml` замените `JWT_SECRET`
на свой и выставьте `COOKIE_SECURE=true`, если работаете через HTTPS.

## Ограничения и что дальше

Осознанно **вне MVP**:

- комнаты и незавершённые партии живут **в памяти процесса** — рестарт сервера стирает их;
- JWT не отзывается при logout и не имеет refresh-токенов;
- нет подтверждения email, восстановления пароля, рейтинга, чата, зрителей и таймера на ход;
- горизонтальное масштабирование требует sticky sessions и общего хранилища (Redis) — `RoomRegistry` специально повторяет интерфейс, который легко заменить адаптером;
- `node:sqlite` на текущих Node печатает `ExperimentalWarning` — это ожидаемо;
- нет ESLint/Prettier и e2e на Playwright — при желании добавляются без изменения архитектуры.
