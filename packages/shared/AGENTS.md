# AGENTS.md — packages/shared

Shared package: game rules, types, and the client/server protocol. This is
**pure TypeScript with no dependencies** — no Node.js, DOM, Fastify, Vue, or
network/database access here.

## Files

- `src/constants.ts` — board size, winning lines, room-code alphabet, limits.
- `src/types.ts` — `Game`, `PublicGame`, `PlayerSlot`, `GameMode`, `BotDifficulty`, `GameError`, error codes.
- `src/protocol.ts` — WS messages, auth, history and leaderboard types, `GameSessionResponse`.
- `src/game.ts` — `createGame`, `createBotGame`, `joinGame`, `applyMove`, `startRematch`, `toPublicGame`, `sanitizeName`.
- `src/bot.ts` — `chooseBotMove`, `isBotDifficulty`, `BOT_DIFFICULTIES`.
- `src/rating.ts` — `RATING_START`, `RATING_MIN`, `RATING_K`, `expectedScore`, `nextRating`, `ratingDelta`.
- `src/index.ts` — public exports and the `isClientMessage`/`isServerMessage` type guards.

Use the `.js` suffix for imports inside the package (ESM).

## Game invariants

- Board is 3×3; `X` always moves first; the room creator gets `X`.
- `Game.version` increments on every change; a move with a stale `version` is rejected with `STALE_STATE`.
- `Game.round` starts at 1; every rematch increments it.
- `startRematch`: requires a second player; after two votes the board is cleared, marks are swapped (`X ↔ O`), `turn = 'X'`, and `winner = null`.
- `applyMove`: validates status, version, membership, turn, index, and cell occupancy.
- A win or a full board moves the game to `finished`; `winner` is `X`, `O`, or `draw`.
- `abandoned` is set by the server, never by the client.
- `sanitizeName`: trims to 20 characters, collapses whitespace, strips control characters; an empty name becomes `null`.

## Bot and rating

- `createBotGame` builds a `mode: 'bot'` game with the bot in `O`, `connected: true`, and `status: 'playing'` immediately; `botPlayerId` stays out of `PublicGame`.
- `chooseBotMove` is pure and accepts an injectable `random`: `easy` is random, `medium` wins/blocks then plays optimally 60% of the time, `hard` is minimax and must never lose. Keep the exhaustive non-loss test.
- ELO math lives only in `rating.ts`; the server must use `nextRating`, not re-implement it.
- `ratingDelta` is a convenience wrapper for display; it is not stored.

## Public snapshot

`toPublicGame(game)` is the only way to expose state to the client.

- It does not include `playerId`, `botPlayerId`, `token`, or `updatedAt`.
- `players.X/O` contain only `name` and `connected`.
- `rematchVotes` are exposed as marks (`Mark[]`), not `playerId`s.
- `mode` and `botDifficulty` are exposed so the client can render bot games.
- It does not mutate the source `Game`.

If you add a field to `PublicGame`, verify that it does not reveal player
identity and does not break the client protocol.

## Protocol

- `ClientMessage`: `move`, `rematch`, `leave`, `ping`.
- `ServerMessage`: `state`, `error`, `pong`.
- `GameSessionResponse` no longer contains a player token: identity comes from the cookie; it does include `mode`.
- `AuthUser` includes `rating: number | null` (`null` for guests).
- `StatsResponse` includes `rating`, `bestRating`, `ratedGames`, `rank`; `MatchSummary` includes `rated`, `ratingDelta`, `ratingAfter`.
- `LeaderboardEntry`/`LeaderboardResponse` are the leaderboard contract; entries never carry user IDs.
- `AuthUser`, `AuthResponse`, `StatsResponse`, `MatchSummary`, `MatchListResponse` are the HTTP API contract.
- `isClientMessage` is the strict validator for incoming WS messages; update it when the format changes.
- Add new error codes to `ErrorCode`; the server status mapping lives in `apps/server/src/errors.ts`.

## Change order

1. Update types/rules in `packages/shared`.
2. Update the server (`apps/server`).
3. Update the client (`apps/client`).
4. Update tests in all affected packages.

Do not change the protocol on only one side: that breaks compatibility.

## Tests

```bash
npm run test -w @ttt/shared
npm run typecheck -w @ttt/shared
```

`test/game.test.ts` covers creation/joining, all winning lines, draws, turn
order, versions, rematches, name sanitization, and the absence of `playerId` in
the public snapshot. `test/bot.test.ts` covers all difficulties, bot-game
creation, and the exhaustive check that `hard` never loses. `test/rating.test.ts`
covers ELO math. A new game rule must come with a test.
