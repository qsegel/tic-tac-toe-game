import assert from 'node:assert/strict';
import test from 'node:test';
import type { Game, Mark, StatsResponse } from '@ttt/shared';
import { applyMove, createGame, joinGame, makeSlot, startRematch } from '@ttt/shared';
import { openDatabase } from '../src/db.js';
import { MatchHistory } from '../src/history.js';

const X_ID = 'usr_x';
const O_ID = 'usr_o';

function makePlayingGame(overrides: { xId?: string; oId?: string; now?: number } = {}): Game {
  const now = overrides.now ?? 1_000;
  const host = makeSlot({ playerId: overrides.xId ?? X_ID, name: 'Аня' });
  const guest = makeSlot({ playerId: overrides.oId ?? O_ID, name: 'Боб' });
  return joinGame(
    createGame({ id: `game-${now}`, code: 'ABC234', host, now }),
    guest,
    now + 1,
  );
}

function play(game: Game, playerId: string, index: number, now: number): Game {
  return applyMove(game, { playerId, index, version: game.version }, now);
}

/** Игрок с меткой X выигрывает по верхней линии: 0,1,2. */
function xWins(game: Game, now = 2_000): Game {
  const xId = game.players.X.playerId;
  const oId = game.players.O?.playerId;
  assert.ok(oId, 'у партии должно быть два игрока');

  let next = play(game, xId, 0, now);
  next = play(next, oId, 3, now + 1);
  next = play(next, xId, 1, now + 2);
  next = play(next, oId, 4, now + 3);
  return play(next, xId, 2, now + 4);
}

function draw(game: Game, now = 2_000): Game {
  const moves: Array<[Mark, number]> = [
    ['X', 0],
    ['O', 1],
    ['X', 2],
    ['O', 4],
    ['X', 3],
    ['O', 5],
    ['X', 7],
    ['O', 6],
    ['X', 8],
  ];
  return moves.reduce((current, [mark, index], offset) => {
    const playerId = mark === 'X' ? game.players.X.playerId : game.players.O?.playerId;
    assert.ok(playerId, 'у партии должно быть два игрока');
    return play(current, playerId, index, now + offset);
  }, game);
}

function withDb(t: test.TestContext): { db: ReturnType<typeof openDatabase>; history: MatchHistory } {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  return { db, history: new MatchHistory(db) };
}

/** Счётчики без рейтинговых полей: они проверяются отдельными тестами. */
function expectCounts(actual: StatsResponse, expected: Omit<StatsResponse, 'rating' | 'bestRating' | 'ratedGames' | 'rank'>): void {
  assert.deepEqual(
    {
      wins: actual.wins,
      losses: actual.losses,
      draws: actual.draws,
      abandoned: actual.abandoned,
      played: actual.played,
    },
    expected,
  );
}

test('победа записывает win победителю и loss проигравшему', (t) => {
  const { history } = withDb(t);
  const finished = xWins(makePlayingGame());
  assert.equal(finished.status, 'finished');
  assert.equal(finished.winner, 'X');

  history.record(finished);

  expectCounts(history.stats(X_ID), { wins: 1, losses: 0, draws: 0, abandoned: 0, played: 1 });
  expectCounts(history.stats(O_ID), { wins: 0, losses: 1, draws: 0, abandoned: 0, played: 1 });

  const list = history.list(X_ID, 20, 0);
  assert.equal(list.total, 1);
  assert.equal(list.hasMore, false);
  assert.equal(list.matches[0]?.result, 'win');
  assert.equal(list.matches[0]?.myMark, 'X');
  assert.equal(list.matches[0]?.opponentName, 'Боб');
  assert.equal(list.matches[0]?.round, 1);
  assert.equal(list.matches[0]?.status, 'finished');
});

test('ничья записывается как draw обоим игрокам', (t) => {
  const { history } = withDb(t);
  const finished = draw(makePlayingGame());
  assert.equal(finished.status, 'finished');
  assert.equal(finished.winner, 'draw');

  history.record(finished);

  expectCounts(history.stats(X_ID), { wins: 0, losses: 0, draws: 1, abandoned: 0, played: 1 });
  expectCounts(history.stats(O_ID), { wins: 0, losses: 0, draws: 1, abandoned: 0, played: 1 });
});

test('abandoned: ушедший получает abandoned, оставшийся — win', (t) => {
  const { history } = withDb(t);
  const game = makePlayingGame();
  const abandoned: Game = {
    ...game,
    status: 'abandoned',
    winner: 'O',
    version: game.version + 1,
    updatedAt: 3_000,
  };

  history.record(abandoned);

  expectCounts(history.stats(X_ID), { wins: 0, losses: 0, draws: 0, abandoned: 1, played: 1 });
  expectCounts(history.stats(O_ID), { wins: 1, losses: 0, draws: 0, abandoned: 0, played: 1 });

  assert.equal(history.list(X_ID, 20, 0).matches[0]?.result, 'abandoned');
  assert.equal(history.list(O_ID, 20, 0).matches[0]?.result, 'win');
});

test('abandoned без победителя: оба получают abandoned', (t) => {
  const { history } = withDb(t);
  const game = makePlayingGame();
  const abandoned: Game = {
    ...game,
    status: 'abandoned',
    winner: null,
    version: game.version + 1,
    updatedAt: 3_000,
  };

  history.record(abandoned);

  assert.equal(history.stats(X_ID).abandoned, 1);
  assert.equal(history.stats(O_ID).abandoned, 1);
});

test('каждый рематч — отдельный матч с новым раундом', (t) => {
  const { history } = withDb(t);

  const first = xWins(makePlayingGame({ now: 1_000 }), 2_000);
  history.record(first);

  const voteX = startRematch(first, X_ID, 3_000);
  assert.equal(voteX.started, false);
  const second = startRematch(voteX.game, O_ID, 3_001).game;
  assert.equal(second.status, 'playing');
  assert.equal(second.round, 2);
  // После рематча метки меняются: X теперь у Боба.
  assert.equal(second.players.X.playerId, O_ID);

  const finishedSecond = xWins(second, 4_000);
  assert.equal(finishedSecond.winner, 'X');
  history.record(finishedSecond);

  expectCounts(history.stats(X_ID), { wins: 1, losses: 1, draws: 0, abandoned: 0, played: 2 });
  expectCounts(history.stats(O_ID), { wins: 1, losses: 1, draws: 0, abandoned: 0, played: 2 });

  const list = history.list(X_ID, 20, 0);
  assert.equal(list.total, 2);
  assert.deepEqual(
    list.matches.map((match) => match.round),
    [2, 1],
    'история отсортирована от свежих к старым',
  );
});

test('повторная запись того же раунда не создаёт дубликат', (t) => {
  const { history } = withDb(t);
  const finished = xWins(makePlayingGame());

  history.record(finished);
  history.record(finished);

  assert.equal(history.stats(X_ID).played, 1);
  assert.equal(history.list(X_ID, 20, 0).total, 1);
});

test('партия двух гостей не сохраняется', (t) => {
  const { history } = withDb(t);
  const finished = xWins(makePlayingGame({ xId: 'guest_x', oId: 'guest_o' }));

  history.record(finished);

  assert.equal(history.list('guest_x', 20, 0).total, 0);
  assert.equal(history.list('guest_o', 20, 0).total, 0);
});

test('партия с гостем сохраняется только зарегистрированному игроку', (t) => {
  const { history } = withDb(t);
  const finished = xWins(makePlayingGame({ oId: 'guest_o' }));

  history.record(finished);

  assert.equal(history.stats(X_ID).wins, 1);
  assert.equal(history.list('guest_o', 20, 0).total, 0);
  assert.equal(history.list(X_ID, 20, 0).matches[0]?.opponentName, 'Боб');
});

test('list поддерживает пагинацию', (t) => {
  const { history } = withDb(t);

  for (let index = 0; index < 3; index += 1) {
    const game = xWins(makePlayingGame({ now: 1_000 + index * 100 }), 2_000 + index * 100);
    history.record({ ...game, id: `game-${index}` });
  }

  const firstPage = history.list(X_ID, 2, 0);
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.matches.length, 2);
  assert.equal(firstPage.hasMore, true);

  const secondPage = history.list(X_ID, 2, 2);
  assert.equal(secondPage.matches.length, 1);
  assert.equal(secondPage.hasMore, false);
});
