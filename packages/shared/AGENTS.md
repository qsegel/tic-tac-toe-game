# AGENTS.md — packages/shared

Shared package: game rules, types, and the client/server protocol. This is
**pure TypeScript with no dependencies** — no Node.js, DOM, Fastify, Vue, or
network/database access here.

## Files

- `src/constants.ts` — board size, winning lines, room-code alphabet, limits.
- `src/types.ts` — `Game`, `PublicGame`, `PlayerSlot`, `GameError`, error codes.
- `src/protocol.ts` — WS messages, auth and history types, `GameSessionResponse`.
- `src/game.ts` — `createGame`, `joinGame`, `applyMove`, `startRematch`, `toPublicGame`, `sanitizeName`.
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

## Public snapshot

`toPublicGame(game)` is the only way to expose state to the client.

- It does not include `playerId`, `token`, or `updatedAt`.
- `players.X/O` contain only `name` and `connected`.
- `rematchVotes` are exposed as marks (`Mark[]`), not `playerId`s.
- It does not mutate the source `Game`.

If you add a field to `PublicGame`, verify that it does not reveal player
identity and does not break the client protocol.

## Protocol

- `ClientMessage`: `move`, `rematch`, `leave`, `ping`.
- `ServerMessage`: `state`, `error`, `pong`.
- `GameSessionResponse` no longer contains a player token: identity comes from the cookie.
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
the public snapshot. A new game rule must come with a test.
