import assert from 'node:assert/strict';
import test from 'node:test';
import type { Game } from '@ttt/shared';
import { applyMove, createGame, joinGame, makeSlot } from '@ttt/shared';
import { openDatabase } from '../src/db.js';
import { MatchHistory } from '../src/history.js';

const X_ID = 'usr_x';
const O_ID = 'usr_o';

function makePlayingGame(): Game {
  const host = makeSlot({ playerId: X_ID, name: 'Аня' });
  const guest = makeSlot({ playerId: O_ID, name: 'Боб' });
  return joinGame(createGame({ id: 'game-1', code: 'ABC234', host, now: 1_000 }), guest, 1_001);
}

function play(game: Game, playerId: string, index: number, now: number): Game {
  return applyMove(game, { playerId, index, version: game.version }, now);
}

function xWins(game: Game): Game {
  const oId = game.players.O?.playerId;
  assert.ok(oId);
  let next = play(game, X_ID, 0, 2_000);
  next = play(next, oId, 3, 2_001);
  next = play(next, X_ID, 1, 2_002);
  next = play(next, oId, 4, 2_003);
  return play(next, X_ID, 2, 2_004);
}

function draw(game: Game): Game {
  const moves: Array<[string, number]> = [
    [X_ID, 0],
    [O_ID, 1],
    [X_ID, 2],
    [O_ID, 4],
    [X_ID, 3],
    [O_ID, 5],
    [X_ID, 7],
    [O_ID, 6],
    [X_ID, 8],
  ];
  return moves.reduce((current, [playerId, index], offset) => {
    return play(current, playerId, index, 3_000 + offset);
  }, game);
}

function withDb(t: test.TestContext): { db: ReturnType<typeof openDatabase>; history: MatchHistory } {
  const db = openDatabase(':memory:');
  t.after(() => db.close());

  const insert = db.prepare(
    'INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  insert.run(X_ID, 'x@example.com', 'Аня', 'hash', 1_000);
  insert.run(O_ID, 'o@example.com', 'Боб', 'hash', 1_001);

  return { db, history: new MatchHistory(db) };
}

test('рейтинг: победа и поражение меняют рейтинг обоих игроков', (t) => {
  const { history } = withDb(t);
  history.record(xWins(makePlayingGame()));

  const x = history.stats(X_ID);
  assert.equal(x.rating, 1016);
  assert.equal(x.bestRating, 1016);
  assert.equal(x.ratedGames, 1);
  assert.equal(x.rank, 1);

  const o = history.stats(O_ID);
  assert.equal(o.rating, 984);
  assert.equal(o.bestRating, 1000, 'лучший рейтинг не падает');
  assert.equal(o.ratedGames, 1);
  assert.equal(o.rank, 2);

  const match = history.list(X_ID, 20, 0).matches[0];
  assert.equal(match?.rated, true);
  assert.equal(match?.ratingDelta, 16);
  assert.equal(match?.ratingAfter, 1016);
});

test('рейтинг: ничья не меняет рейтинг, но считается рейтинговой', (t) => {
  const { history } = withDb(t);
  history.record(draw(makePlayingGame()));

  const x = history.stats(X_ID);
  assert.equal(x.rating, 1000);
  assert.equal(x.ratedGames, 1);
  assert.equal(history.stats(O_ID).rating, 1000);

  const match = history.list(X_ID, 20, 0).matches[0];
  assert.equal(match?.rated, true);
  assert.equal(match?.ratingDelta, 0);
});

test('рейтинг: abandoned не меняет рейтинг', (t) => {
  const { history } = withDb(t);
  const game = makePlayingGame();
  history.record({ ...game, status: 'abandoned', winner: 'O', version: game.version + 1 });

  const x = history.stats(X_ID);
  assert.equal(x.rating, 1000);
  assert.equal(x.ratedGames, 0);
  assert.equal(x.rank, null);

  const match = history.list(X_ID, 20, 0).matches[0];
  assert.equal(match?.rated, false);
  assert.equal(match?.ratingDelta, null);
});

test('рейтинг: партия с гостем сохраняется, но не рейтингуется', (t) => {
  const { history } = withDb(t);
  const host = makeSlot({ playerId: X_ID, name: 'Аня' });
  const guest = makeSlot({ playerId: 'guest_o', name: 'Гость' });
  const game = joinGame(createGame({ id: 'game-2', code: 'ABC235', host, now: 1_000 }), guest, 1_001);

  history.record(xWins(game));

  assert.equal(history.stats(X_ID).wins, 1);
  assert.equal(history.stats(X_ID).ratedGames, 0);
  assert.equal(history.list(X_ID, 20, 0).matches[0]?.rated, false);
});

test('рейтинг: партия с ботом не попадает в историю', (t) => {
  const { history } = withDb(t);
  const game = xWins(makePlayingGame());
  history.record({ ...game, mode: 'bot', botPlayerId: O_ID });

  assert.equal(history.list(X_ID, 20, 0).total, 0);
  assert.equal(history.stats(X_ID).ratedGames, 0);
});

test('рейтинг: повторная запись раунда не начисляет очки дважды', (t) => {
  const { history } = withDb(t);
  const game = xWins(makePlayingGame());

  history.record(game);
  history.record(game);

  assert.equal(history.stats(X_ID).rating, 1016);
  assert.equal(history.stats(X_ID).ratedGames, 1);
});

test('лидерборд: сортировка, пагинация, me и исключение новичков', (t) => {
  const { db, history } = withDb(t);
  history.record(xWins(makePlayingGame()));

  // Новичок без рейтинговых партий не должен занимать место в таблице.
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('usr_new', 'new@example.com', 'Новичок', 'hash', 2_000);

  const page = history.leaderboard(1, 0, O_ID);
  assert.equal(page.total, 2);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0]?.name, 'Аня');
  assert.equal(page.entries[0]?.position, 1);
  assert.equal(page.entries[0]?.isMe, false);
  assert.equal(page.hasMore, true);

  const second = history.leaderboard(10, 1, O_ID);
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0]?.name, 'Боб');
  assert.equal(second.entries[0]?.position, 2);
  assert.equal(second.entries[0]?.isMe, true);
  assert.equal(second.me?.position, 2);
  assert.equal(second.me?.rating, 984);

  const anonymous = history.leaderboard(10, 0, null);
  assert.equal(anonymous.me, null);
  assert.ok(anonymous.entries.every((entry) => entry.isMe === false));
});

test('лидерборд: W/L/D только по рейтинговым партиям, stats — по всем', (t) => {
  const { history } = withDb(t);
  history.record(xWins(makePlayingGame()));

  const host = makeSlot({ playerId: X_ID, name: 'Аня' });
  const guest = makeSlot({ playerId: 'guest_g', name: 'Гость' });
  const guestGame = joinGame(
    createGame({ id: 'game-guest', code: 'ABC999', host, now: 2_000 }),
    guest,
    2_001,
  );
  history.record(xWins(guestGame));

  const me = history.leaderboard(10, 0, X_ID).entries.find((entry) => entry.isMe);
  assert.equal(me?.games, 1);
  assert.equal(me?.wins, 1);
  assert.equal(me?.losses, 0);
  assert.equal(me?.draws, 0);

  // Профиль по-прежнему показывает все партии, включая игру с гостем.
  assert.equal(history.stats(X_ID).wins, 2);
});

test('лидерборд: при полном равенстве порядок детерминирован по id', (t) => {
  const { db, history } = withDb(t);
  history.record(draw(makePlayingGame()));
  db.prepare('UPDATE users SET created_at = 5').run();

  // id 'usr_o' < 'usr_x', поэтому при равных рейтинге/играх/времени первым идёт Боб.
  const page = history.leaderboard(10, 0, null);
  assert.deepEqual(
    page.entries.map((entry) => entry.name),
    ['Боб', 'Аня'],
  );
  assert.deepEqual(
    page.entries.map((entry) => entry.position),
    [1, 2],
  );
  assert.equal(page.me, null);
});
