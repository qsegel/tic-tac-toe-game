# AGENTS.md

Rules for working with the "Tic-Tac-Toe Online" repository. This file covers
architectural invariants and the verification workflow; see `README.md` for the
public API.

## Stack and structure

- **npm workspaces monorepo.** Packages: `packages/shared`, `apps/server`, `apps/client`.
- **Client:** Vue 3, TypeScript, Pinia, Vue Router, Vite.
- **Server:** Node.js ≥ 22.13, Fastify 5, `@fastify/jwt`, `@fastify/cookie`, `@fastify/websocket`.
- **Database:** SQLite via the built-in `node:sqlite` (`DatabaseSync`).
- **Shared:** `packages/shared` — pure TypeScript with no dependencies: game rules, types, and protocol.

```text
packages/shared/   domain and client/server contract
apps/server/       Fastify API, WebSocket, SQLite, auth
apps/client/       Vue SPA
```

## Commands

```bash
npm install
npm run dev          # server :3000 + client :5173
npm run typecheck    # tsc + vue-tsc
npm test             # shared + server + client
npm run build        # build the client into apps/client/dist
npm start            # production server: API, WS, static files
```

Verification before completing a task: **`npm run typecheck` → `npm test` → `npm run build`**.
If UI flows changed, also verify the relevant scenario manually.

## Key invariants

### Game

- **The server is the single source of truth.** The client does not compute the winner or decide whose turn it is.
- **`version`** increments on every change; a stale move is rejected (`STALE_STATE`).
- **`round`** starts at 1 and increments on every rematch.
- **Rematch:** both players vote, the board is cleared, marks are swapped (`X ↔ O`), and `X` moves first again.
- **`abandoned`:** the player who stays connected gets the win, the player who left gets `abandoned`. If both left, there is no winner.
- **Bot games:** `mode: 'bot'`, bot occupies `O` with `playerId = bot_…` and `connected: true` but no socket. Three difficulties (`easy`, `medium`, `hard`); `hard` is minimax and never loses. Bot games are never written to history and never affect rating. A human leaving a bot game deletes the room immediately.
- **`PublicGame` does not contain `playerId` or `botPlayerId`.** Do not add player identifiers to it. It does expose `mode` and `botDifficulty`.
- Rooms and unfinished games live **in process memory**. A server restart wipes them.

### Rating

- ELO: start `1000`, `K = 32`, floor `100`, draw = `0.5` (`packages/shared/src/rating.ts`).
- Only `finished` games with **two `usr_…` players** are rated. `abandoned`, guest games, and bot games never change rating.
- Rating writes and match insertion happen in the same `BEGIN IMMEDIATE` transaction; `UNIQUE (game_id, round)` makes recording idempotent.
- `match_players` stores `rating_before` / `rating_after`; `users` stores `rating`, `best_rating`, `rated_games`.
- Leaderboard includes only users with `rated_games > 0` and never exposes user IDs or emails. It is available to guests.
- Existing matches stay unrated; do not backfill.

### Accounts and sessions

- JWT HS256 in the httpOnly cookie `ttt_session`, valid for 24 hours, with no refresh tokens.
- Claims: `sub`, `role: user | guest`, `iss: ttt`, `aud: ttt-web`, `exp`.
- `playerId` is `usr_…` for an account and `guest_…` for a guest. There is no separate player token.
- Passwords use `scrypt` + `timingSafeEqual`.
- Guests can play (including against the bot), but `/api/me/stats` and `/api/me/matches` return `403 ACCOUNT_REQUIRED` for them. `/api/leaderboard` is public to any authenticated user, including guests.
- Logout only clears the cookie; the JWT is not revoked until `exp`.

### History

- SQLite stores only completed rounds with at least one registered player.
- A guest-vs-guest game is not saved; a bot game is not saved at all.
- The rating migration is schema version 2; old rows stay `rated = 0`.
- Each rematch round is a separate record; duplicates are prevented by `UNIQUE (game_id, round)`.
- `finished`: the winner gets `win`, the loser gets `loss`, and a draw gives `draw` to both.
- `abandoned`: the player who stayed gets `win`, the player who left gets `abandoned`; if there is no winner, both get `abandoned`.

## Code conventions

- TypeScript strict, ESM.
- Use the `.js` suffix for relative imports in server and shared code (tsx/ESM).
- The client imports shared code via `@ttt/shared`; the `@` alias points to `apps/client/src`.
- Vue: `<script setup lang="ts">`, Composition API, Pinia setup stores.
- Component styles use CSS modules; global styles live in `apps/client/src/styles.css`.
- UI copy and error messages are in Russian.
- Add new error codes to `packages/shared/src/types.ts` and to the mapping in `apps/server/src/errors.ts`.
- When changing the protocol, update `packages/shared` first, then the server and client, then the tests.

## Do not

- Do not store the JWT in `localStorage`, `sessionStorage`, or the URL.
- Do not add refresh tokens or JWT revocation without a separate decision.
- Do not move live game state into SQLite.
- Do not change `PublicGame` so that it includes `playerId` or secrets.
- Do not edit `apps/client/dist` or other build artifacts.
- Do not commit `apps/server/data/`, `*.db`, `*.db-wal`, `*.db-shm`, or `.env`.
- Do not bypass server authentication with a `playerId` from the query string or request body.

## Where to look

- `README.md` — public API, WebSocket protocol, configuration, Docker.
- `apps/server/AGENTS.md` — Fastify, auth, SQLite, rooms, WS.
- `apps/client/AGENTS.md` — Pinia, router, sessions, UI.
- `packages/shared/AGENTS.md` — game rules and protocol contract.
