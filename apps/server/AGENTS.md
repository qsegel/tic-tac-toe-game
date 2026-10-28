# AGENTS.md — apps/server

Server side: Fastify 5, WebSocket, JWT authentication, and SQLite.

## Entry points

- `src/index.ts` — reads env, calls `buildApp`, listens on the port, and handles graceful shutdown.
- `src/app.ts` — `buildApp(options)`: assembles the application for production and tests.
- In tests, use `buildApp({ logger: false, databasePath: ':memory:', jwtSecret: '…' })`.
- `src/index.ts` defaults the database to `apps/server/data/ttt.db`; tests use in-memory storage.

## Application assembly order

Keep this order in `buildApp`:

1. `@fastify/cookie`
2. `@fastify/jwt`
3. `@fastify/cors`
4. `@fastify/rate-limit`
5. `@fastify/websocket`
6. `AuthService`, the `request.authUser` decorator, `app.authenticate`
7. Auth routes, game routes, profile routes, WS
8. Subscription to `RoomRegistry` for match history recording
9. Error handler, CSRF hook, `onSend`, static files, 404 handler

`app.authenticate` is the preHandler for protected HTTP routes. It populates
`request.authUser`; do not duplicate cookie parsing in route handlers.

## Authentication

Files: `src/auth/passwords.ts`, `users.ts`, `session.ts`, `routes.ts`.

- Cookie `ttt_session`: `httpOnly`, `SameSite=Lax`, `path=/`, 24 hours; `Secure` when `COOKIE_SECURE=true` or over HTTPS.
- JWT: HS256, claims `sub`, `role`, `iss: ttt`, `aud: ttt-web`, `exp`.
- Passwords: scrypt (`N=16384, r=8, p=1`, 64 bytes) + `timingSafeEqual`.
- `AuthService.authenticateRequest` for HTTP; `authenticateToken` for WebSocket.
- A guest gets `guest_…`, an account gets `usr_…`; there is no separate player token.
- Rate limits: registration 5/min, login 10/min, guest 20/min, `/api/auth/me` 120/min.
- CSRF: `SameSite=Lax` plus an `Origin` check for unsafe `/api/*` requests when `CLIENT_ORIGIN` is set.

Do not put the JWT in a URL, query string, or response body. Do not log cookies.

## SQLite

File: `src/db.ts`. Uses `node:sqlite` (`DatabaseSync`).

- File-backed databases enable WAL and `busy_timeout`; `:memory:` does not need WAL.
- Migrations use `PRAGMA user_version`. A new schema means a new migration with an incremented version.
- Never edit an existing migration after the fact: add the next one.
- History writes use a `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` transaction.
- Tables: `users`, `matches`, `match_players`; round uniqueness is enforced by `UNIQUE (game_id, round)`.
- Do not commit database files or `-wal`/`-shm` files.

## Rooms

File: `src/rooms.ts`.

- `RoomRegistry` stores `Game` objects in memory; identity is `playerId` (`usr_…` / `guest_…`).
- `subscribe(listener)` is the only way to subscribe to changes; do not add a second mechanism.
- `create`, `join`, `attach`, `detach`, `leave`, `move`, `rematch`, `sweep`.
- `join` is idempotent for a player who has already joined.
- `detach` starts the grace period; afterwards the game becomes `abandoned` or the waiting room is deleted.
- On `abandoned`, the winner is set only if the opponent stayed connected.
- `sweep` deletes rooms without connected players after the TTL.
- Do not store tokens in `PlayerSlot`, and do not add `playerId` to the public snapshot.

## WebSocket

File: `src/ws.ts`.

- Connection: `/ws?code=ABC234`; authentication uses the `ttt_session` cookie.
- Missing/invalid cookie → close `1008` with reason `unauthorized`.
- Missing code → close `1008` with reason `code-required`.
- Sockets are keyed by `gameId:playerId`; a new socket replaces the old one (`4001`).
- There is a heartbeat, a per-IP socket limit, message and move limits, and `maxPayload`.
- Do not add query-token authentication: identity comes from the cookie.
- When a socket closes, call `registry.detach(gameId, playerId)`, otherwise the player remains "connected".

## History and stats

File: `src/history.ts`; routes — `src/profile.ts`.

- `record(game)` is called through a `RoomRegistry` subscription and is idempotent.
- Only `finished`/`abandoned` games with two players and at least one `usr_…` are recorded.
- A guest-vs-guest game is not recorded.
- `resultFor`: win/loss/draw for finished games; win/abandoned for abandoned games.
- `stats` and `list` read only the current user's rows in `match_players`.
- Do not rely on the subscriber order between WS and history: deduplication is guaranteed by the unique index, not by call order.

## Errors

- Domain errors are `GameError` from `@ttt/shared`.
- HTTP statuses live in `src/errors.ts` (`statusByCode`).
- Add a new error code to `packages/shared/src/types.ts` and to `statusByCode`.
- Do not expose stack traces or internal SQLite details.

## Tests

```bash
npm run test -w @ttt/server
npm run typecheck -w @ttt/server
```

- `test/api.test.ts` — HTTP + WebSocket, rooms, limits, reconnect, abandoned.
- `test/auth.test.ts` — registration, login, guest, logout, CSRF.
- `test/history.test.ts` — win/loss/draw/abandoned, rematches, guests, pagination.
- `test/logging.test.ts` — secret redaction in URLs.

For integration tests, start a real server on `port: 0` and use `fetch`/`ws`,
as the existing tests do. Extract the cookie from `set-cookie`.
