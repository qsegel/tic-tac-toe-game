# AGENTS.md — apps/client

Client: Vue 3 + TypeScript + Pinia + Vue Router + Vite.

## Entry points

- `src/main.ts` — creates the app, installs Pinia first, then the router.
- `src/App.vue` — header, account navigation, logout.
- `src/router.ts` — routes and guards.
- `src/lib/api.ts` — HTTP client and WebSocket URL builder.
- `src/lib/session.ts` — game session in `sessionStorage` and guest name in `localStorage`.

## Client-side authentication

Store: `src/stores/auth.ts`.

- `bootstrap()` is called from the router guard once; repeated calls return the same result.
- `user` is the current user or `null`; `ready` means the cookie check has finished.
- `isGuest` is `user.guest === true`; `isAuthenticated` is `user !== null`.
- `login`, `register`, `loginAsGuest`, `logout`, `clear`.
- On a 401 from the API, call `auth.clear()` and redirect to `/auth` with a `redirect` query.
- The JWT lives only in the httpOnly cookie. Do not put it in `localStorage`, `sessionStorage`, Pinia, or the URL.

## Router

- `/` — `HomeView`.
- `/auth` — `AuthView`; a registered user is redirected to `redirect` or `/`.
- `/profile` — `ProfileView`, requires authentication.
- `/leaderboard` — `LeaderboardView`, requires authentication (guests can view it too).
- `/game/:code` — `GameView`, requires authentication.
- The guard first waits for `auth.bootstrap()`, then checks `meta.requiresAuth`.
- `safeRedirect()` allows only internal paths: starts with `/`, not `//`, and contains no `\` or control characters.
- Do not add redirects to external URLs from the query string.

## Game session

- User identity comes from the cookie and is shared across tabs.
- The game session (`gameId`, `code`, `playerId`, `mark`, `mode`) lives in `sessionStorage`, so each tab has its own game. Old saved sessions without `mode` are loaded as `pvp`.
- The guest name lives in `localStorage` so it does not have to be re-entered.
- After a rematch the marks are swapped; take the current mark from `state.you`, not from the old session.
- Do not store tokens in the session: they no longer exist.

## API client

File: `src/lib/api.ts`.

- All requests use `credentials: 'include'`.
- Errors are normalized to `ApiError` with `code`, `message`, and `status`.
- `BASE_URL` is `VITE_API_URL` or the current origin.
- `websocketUrl(code)` builds `/ws?code=…` from `VITE_WS_URL`, the API origin, or the current origin.
- Do not pass `playerId` manually on protected requests: the server reads it from the cookie.
- On a 401, handle the expired-session flow instead of showing a raw error.

## Game store

File: `src/stores/game.ts`.

- `enter(code)` loads the saved session and connects the socket; changing the code closes the old one.
- `create()` and `join(code)` call the API and save the session.
- `createBot(difficulty)` calls `POST /api/games/bot`, saves the session, and connects. `isBotGame` reflects `game.mode` or `session.mode`.
- `play(index)` sends a move only when `canPlay` is true; after sending it waits for `state` (`awaitingState`).
- `voteRematch()` sends a vote only when the socket is open and the player has not voted yet.
- `leave()` sends `leave`, clears the session, and closes the socket.
- `disconnect()` closes the socket without reconnecting; use it in `onUnmounted`.
- Reconnect uses exponential backoff; the heartbeat sends a ping every 25 seconds.
- Close reasons: `unauthorized` → reset auth; `NOT_FOUND`/`NOT_IN_GAME`/`code-required` → reset the game session; `4001` → "game is open in another tab".
- Do not compute the winner on the client: the source of truth is the server's `PublicGame`.

## Views and UI

- `views/HomeView.vue` — CTA for unauthenticated users, create/join room and the bot card with difficulty for authenticated users.
- `views/AuthView.vue` — login, registration, guest; the mode is stored in the `mode` query.
- `views/GameView.vue` — board, players, status, rematch, invite; join card for invite links. In a bot game the room code/invite is hidden and the opponent shows the difficulty.
- `views/ProfileView.vue` — rating cards (current/best/rank/rated games), win rate, recent form, stats and history with rating deltas; guests see a registration prompt.
- `views/LeaderboardView.vue` — paginated leaderboard, highlights the current user, shows their position even when it is off-page.
- `components/ui/*` — `UiButton`, `UiInput`, `UiCard`, `UiError`.
- Component styles use CSS modules; shared classes and themes live in `src/styles.css`.
- Copy and errors are in Russian; preserve accessibility (`aria-live`, labels, keyboard support).

## Tests

```bash
npm run test -w @ttt/client
npm run typecheck -w @ttt/client
```

- Vitest + jsdom + Vue Test Utils.
- `src/stores/auth.test.ts` — bootstrap, login, guest, logout.
- `src/stores/game.test.ts` — create/join, bot creation, snapshots, reconnect, close reasons, rematch.
- `src/views/HomeView.test.ts` — CTA without auth, game creation, bot start with difficulty.
- `src/views/ProfileView.test.ts` — rating dashboard, form, rating delta.
- `src/views/LeaderboardView.test.ts` — table, own-row highlight, off-page position, empty state.
- `src/lib/*.test.ts` — session and status texts.
- Stub `fetch` and `WebSocket` in tests; do not start a real server.

## Do not

- Do not add `token` to `Session` or to the socket URL.
- Do not store the JWT anywhere JavaScript can access.
- Do not duplicate server-side game rules on the client.
- Do not bypass router guards with direct navigation to protected views.
- Do not edit `apps/client/dist`.
