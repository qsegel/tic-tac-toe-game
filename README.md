# Крестики-нолики онлайн

Игра 1 на 1 в реальном времени: Vue 3 на клиенте, Node.js + Fastify на сервере.
Можно играть из аккаунта или гостем, а если соперника нет — тренироваться с ботом.
Аккаунты, завершённые партии, статистика и рейтинг Эло хранятся в SQLite,
сами комнаты — в памяти процесса.

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
- **Игра с ботом** — три сложности (`easy`, `medium`, `hard`), соперник не нужен, доступно и гостям. Такие партии не попадают в историю и не влияют на рейтинг.
- **Рейтинг Эло** — старт с 1000, K=32, пол 100. Считаются только завершённые партии двух зарегистрированных игроков; `abandoned`, гости и бот не влияют на рейтинг.
- **Лидерборд и профиль** — таблица лучших игроков, место, лучший рейтинг и изменение рейтинга в истории партий.
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
│  ├─ src/game.ts            # createGame, createBotGame, applyMove, startRematch, checkWinner
│  ├─ src/bot.ts             # выбор хода бота: easy/medium/hard (минимакс)
│  ├─ src/rating.ts          # математика Эло: expectedScore, nextRating, ratingDelta
│  ├─ src/types.ts           # Game, PublicGame, GameError, коды ошибок
│  ├─ src/protocol.ts        # типы WS-сообщений, auth, history и лидерборда
│  └─ test/                  # game, bot, rating
├─ apps/server/
│  ├─ src/app.ts             # сборка Fastify (используется и в тестах)
│  ├─ src/auth/              # пароли, пользователи, JWT/cookie, auth-роуты
│  ├─ src/db.ts              # SQLite + миграции (v1 — история, v2 — рейтинг)
│  ├─ src/history.ts         # запись матчей, рейтинг, статистика, история, лидерборд
│  ├─ src/profile.ts         # GET /api/me/stats, /api/me/matches, /api/leaderboard
│  ├─ src/errors.ts          # HTTP-статусы и единый формат ошибок
│  ├─ src/rooms.ts           # RoomRegistry: комнаты, таймеры, TTL, ходы бота
│  ├─ src/routes.ts          # игровые HTTP-эндпоинты, включая /api/games/bot
│  ├─ src/ws.ts              # /ws: cookie-авторизация, heartbeat, лимиты
│  ├─ src/index.ts           # bootstrap + graceful shutdown
│  ├─ test/api.test.ts       # интеграционные тесты HTTP + WebSocket
│  ├─ test/auth.test.ts      # регистрация, вход, гость, CSRF
│  ├─ test/bot.test.ts       # партия с ботом, рематч, гость, выход
│  ├─ test/history.test.ts   # матчи, abandoned, рематчи, статистика
│  ├─ test/leaderboard.test.ts # рейтинг end-to-end, /api/leaderboard
│  ├─ test/rating.test.ts    # начисление Эло, идемпотентность, лидерборд
│  └─ test/logging.test.ts   # редакция секретов в логах
└─ apps/client/
   ├─ src/stores/auth.ts     # Pinia: текущий пользователь и вход
   ├─ src/stores/game.ts     # Pinia: состояние, сокет, реконнект с backoff, бот
   ├─ src/lib/api.ts         # HTTP-клиент (credentials: include)
   ├─ src/lib/session.ts     # игровая сессия (sessionStorage) и имя (localStorage)
   ├─ src/lib/status.ts      # тексты/тональность статуса
   ├─ src/views/             # HomeView, GameView, AuthView, ProfileView, LeaderboardView
   └─ src/components/        # GameBoard, PlayerCard, ConnectionBanner, ui/*
```

## Конфигурация

Сервер читает переменные окружения (и `apps/server/.env`, если файл есть — см. `apps/server/.env.example`):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3000` | порт HTTP/WS |
| `HOST` | `0.0.0.0` | интерфейс |
| `CLIENT_ORIGIN` | пусто | белый список origin через запятую для CORS, проверки `Origin` у WS и CSRF; пусто = CORS выключен, Origin у WS не проверяется (только для локальной разработки) |
| `JWT_SECRET` | — (генерируется) | секрет подписи JWT. В production обязателен (≥ 32 символов, не placeholder), иначе сервер не стартует; без него в dev генерируется случайный секрет и сессии не переживают рестарт |
| `COOKIE_SECURE` | `false` | всегда ставить cookie с флагом `Secure` (за HTTPS reverse-proxy) |
| `DATABASE_PATH` | `apps/server/data/ttt.db` | путь к SQLite-базе |
| `TRUST_PROXY` | `false` | доверять `X-Forwarded-*`; включайте только за reverse-proxy, иначе rate limit и `MAX_SOCKETS_PER_IP` будут общими на весь сайт |
| `MAX_ROOMS` | `10000` | максимум комнат в памяти; при переполнении создание отвечает `503 ROOM_LIMIT` |
| `MAX_SOCKETS_PER_IP` | `8` | максимум одновременных WS-соединений с одного IP |
| `BOT_DELAY_MS` | `550` | пауза перед ходом бота (в тестах выставляется меньше) |
| `ROOM_TTL_MS` | `600000` | через сколько удаляется комната, в которой не осталось подключённых игроков |
| `STATIC_DIR` | `apps/client/dist` | каталог собранного клиента |

Клиент: `VITE_API_URL` (по умолчанию пусто = тот же origin) и `VITE_WS_URL`
(по умолчанию выводится из API/текущего origin). Игровая сессия хранится в
`sessionStorage` (у каждой вкладки своя партия), имя гостя — в `localStorage`,
а личность пользователя — в httpOnly cookie.

## Аккаунты и сессии

- JWT HS256, claims: `sub`, `role: user | guest`, `iss: ttt`, `aud: ttt-web`, `exp` — 24 часа.
- Cookie `ttt_session`: `httpOnly`, `SameSite=Lax`, `path=/`, `Max-Age=86400`; `Secure` при `COOKIE_SECURE=true` или HTTPS.
- Пароли: `scrypt` (`N=32768, r=8, p=3`, 64 байта) + `timingSafeEqual`; одинаковое время ответа для «нет такого email» и «неверный пароль».
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
| `POST` | `/api/games` | — | `201 { gameId, code, playerId, mark: "X", mode: "pvp" }` |
| `POST` | `/api/games/bot` | `{ difficulty?: "easy" \| "medium" \| "hard" }` | `201 { gameId, code, playerId, mark: "X", mode: "bot" }` |
| `POST` | `/api/games/:code/join` | — | `201 { gameId, code, playerId, mark: "O", mode: "pvp" }`; повторный заход того же игрока — `200` |
| `GET` | `/api/games/:code` | — | `200 { game: PublicGame }` |
| `GET` | `/api/me/stats` | — | `200 { wins, losses, draws, abandoned, played, rating, bestRating, ratedGames, rank }` |
| `GET` | `/api/me/matches?limit=20&offset=0` | — | `200 { matches, total, hasMore }` |
| `GET` | `/api/leaderboard?limit=20&offset=0` | — | `200 { entries, total, hasMore, me }` |
| `GET` | `/health` | — | `200 { ok: true }` |

`user`: `{ id, email, name, guest, rating, createdAt }`; у гостя `email: null`,
`guest: true`, `rating: null`. `/api/me/stats` и `/api/me/matches` для гостя
отвечают `403 ACCOUNT_REQUIRED`; `/api/leaderboard` доступен и гостям.
Сложность бота по умолчанию — `medium`; неизвестное значение даёт `400 BAD_REQUEST`.

`matches[]`: `{ id, code, round, status, winner, myMark, result, opponentName, rated, ratingDelta, ratingAfter, finishedAt }`.
`leaderboard.entries[]`: `{ position, name, rating, games, wins, losses, draws, isMe }` —
без id и email; в таблицу попадают только пользователи с `rated_games > 0`.
`games` и `wins/losses/draws` в лидерборде считаются **только по рейтинговым**
партиям, поэтому `games = wins + losses + draws`; партии с гостями и `abandoned`
в этой строке не учитываются (они видны в `/api/me/stats`).

Ошибки: `{ code, message }`, где `code` — машинный (`UNAUTHORIZED`, `INVALID_CREDENTIALS`,
`EMAIL_TAKEN`, `ACCOUNT_REQUIRED`, `ROOM_FULL`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`,
`UNSUPPORTED_MEDIA_TYPE`, …). Ошибки валидации Fastify и rate limit также приводятся
к этому формату. `playerId` в публичный снапшот не попадает.

Все ответы содержат `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
`X-Frame-Options: DENY`; при HTTPS (или `COOKIE_SECURE=true`) — ещё и HSTS.

## История и статистика

- В SQLite сохраняются только партии, где есть хотя бы один зарегистрированный игрок; матч двух гостей не записывается.
- Каждый завершённый раунд — отдельная запись; рематч создаёт новый матч с `round + 1`.
- `finished`: победитель получает `win`, проигравший — `loss`, при ничьей оба получают `draw`.
- `abandoned`: оставшийся в игре получает `win`, ушедший — `abandoned`. Если ушли оба, оба получают `abandoned`.
- `played = wins + losses + draws + abandoned`.
- Повторная запись того же раунда игнорируется (`UNIQUE (game_id, round)`).
- Партии с ботом (`mode: "bot"`) не записываются вовсе.

## Рейтинг Эло

- Стартовый рейтинг — **1000**, коэффициент **K = 32**, нижняя граница — **100**.
- Рейтинг меняется только у **завершённых** партий (`finished`), где **оба** игрока — аккаунты (`usr_…`). Ничья даёт 0.5 обоим.
- `abandoned`, партии с гостем и партии с ботом рейтинг не меняют и не увеличивают `rated_games`.
- Для каждого участника в `match_players` сохраняются `rating_before` и `rating_after`; по ним считается `ratingDelta` в истории.
- `users.rating`, `users.best_rating`, `users.rated_games` обновляются в той же транзакции, что и запись матча.
- В лидерборд попадают только пользователи с `rated_games > 0`; сортировка — `rating DESC`, затем `rated_games DESC`, затем `created_at ASC`.
- Старые матчи, записанные до миграции v2, остаются нерейтинговыми (`rated = 0`), бэкфилла нет.

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
- **Бот** — занимает слот `O` как обычный игрок (`connected: true`, без сокета). Ход планируется на сервере с паузой `BOT_DELAY_MS`; после голоса человека бот сразу голосует за рематч. `PublicGame.mode` и `botDifficulty` сообщают клиенту режим, `botPlayerId` наружу не отдаётся.

## Правила и граничные случаи

- Поле 3×3, побеждают 8 линий; `X` всегда ходит первым; создатель комнаты получает `X`.
- Партия стартует, когда второй игрок вошёл в комнату; если он так и не открыл сокет, через grace-период партия отменяется.
- С ботом партия начинается сразу: `X` — человек, `O` — бот. Сложности: `easy` — случайный ход, `medium` — победа/блок, затем оптимальный ход в 60% случаев, `hard` — минимакс (не проигрывает).
- Явный выход из партии с ботом сразу удаляет комнату; рематч меняет метки как в обычной игре.
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

- `packages/shared` — 41 тест: все выигрышные линии, ничья, очередность, занятые клетки, версии, рематч со сменой меток и раунда, санитайзинг имён (включая эмодзи и bidi), отсутствие утечки `playerId`; ходы бота всех сложностей (включая перебор «человек не может выиграть у hard») и математика Эло.
- `apps/server` — 60 тестов: полная партия, auth (регистрация/вход/гость/logout/CSRF/cookie/JWT), хэширование паролей, история (победа/ничья/abandoned/рематчи/гости/пагинация), рейтинг и лидерборд (только рейтинговые W/L/D), партии с ботом (создание, рематч, гость, выход), `ROOM_FULL`, `ROOM_LIMIT`, ошибки ходов, отмена по grace-таймеру, уход обоих, реконнект, cookie/WS-авторизация, `Origin`, лимиты HTTP/WS (413), security-заголовки, sweep.
- `apps/client` — 69 тестов: тексты статусов, компоненты UI и доски, Pinia-сторы auth и game (создание игры и партии с ботом, снапшоты, защита от двойного клика, смена меток, восстановление сессии, 401), профиль с рейтингом и лидерборд.

## Docker

```bash
JWT_SECRET="$(openssl rand -hex 32)" docker compose up --build
# http://localhost:3000
```

`Dockerfile` — multi-stage: сборка клиента → рантайм с прод-зависимостями.
Контейнер работает от пользователя `node`, у сервиса есть `HEALTHCHECK` на `/health`.
SQLite лежит в named volume `ttt-data` (`/app/apps/server/data`), поэтому история
переживает перезапуск контейнера. `JWT_SECRET` в `docker-compose.yml` обязателен:
без него compose не стартует, а сервер в production не примет пустой/короткий/примерный
секрет. Выставьте `COOKIE_SECURE=true`, если работаете через HTTPS.

## Ограничения и что дальше

Осознанно **вне MVP**:

- комнаты и незавершённые партии живут **в памяти процесса** — рестарт сервера стирает их;
- JWT не отзывается при logout и не имеет refresh-токенов;
- нет подтверждения email, восстановления пароля, чата, зрителей и таймера на ход;
- рейтинг Эло считает только партии «аккаунт против аккаунта»; гости, бот и брошенные партии в рейтинг не входят;
- если второй игрок вошёл в комнату, но так и не открыл сокет, оставшийся получает `win` в статистике (рейтинг не меняется). Это осознанное поведение grace-периода: партия не должна зависать, но статистические победы в таких партиях теоретически можно накрутить;
- горизонтальное масштабирование требует sticky sessions и общего хранилища (Redis) — `RoomRegistry` специально повторяет интерфейс, который легко заменить адаптером;
- `node:sqlite` на текущих Node печатает `ExperimentalWarning` — это ожидаемо;
- нет ESLint/Prettier и e2e на Playwright — при желании добавляются без изменения архитектуры.
