import assert from 'node:assert/strict';
import test from 'node:test';
import { WIN_LINES } from '../src/constants.js';
import {
  applyMove,
  checkWinner,
  createGame,
  isBoardFull,
  joinGame,
  makeSlot,
  markOf,
  sanitizeName,
  startRematch,
  toPublicGame,
} from '../src/game.js';
import { GameError } from '../src/types.js';
import type { Cell, Game, Mark } from '../src/index.js';

const HOST = { playerId: 'p1', name: 'Аня' };
const GUEST = { playerId: 'p2', name: 'Боб' };

function newGame(): Game {
  return createGame({ id: 'game-1', code: 'ABC234', host: makeSlot(HOST), now: 1_000 });
}

function newPlayingGame(): Game {
  return joinGame(newGame(), makeSlot(GUEST), 2_000);
}

function play(game: Game, playerId: string, index: number): Game {
  return applyMove(game, { playerId, index, version: game.version }, 3_000);
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof GameError, 'ожидалась GameError');
    assert.equal(error.code, code);
    return true;
  });
}

test('createGame: пустое поле, ждём соперника, X начинает', () => {
  const game = newGame();
  assert.equal(game.status, 'waiting');
  assert.equal(game.board.length, 9);
  assert.ok(game.board.every((cell) => cell === null));
  assert.equal(game.turn, 'X');
  assert.equal(game.round, 1);
  assert.equal(game.players.O, null);
  assert.equal(game.players.X.name, 'Аня');
  assert.equal(markOf(game, HOST.playerId), 'X');
  assert.equal(markOf(game, GUEST.playerId), null);
});

test('joinGame: второй игрок запускает партию', () => {
  const game = newPlayingGame();
  assert.equal(game.status, 'playing');
  assert.equal(game.players.O?.name, 'Боб');
  assert.equal(game.version, 1);
  assert.equal(markOf(game, GUEST.playerId), 'O');
});

test('joinGame: третий игрок получает ROOM_FULL', () => {
  const game = newPlayingGame();
  expectCode(() => joinGame(game, makeSlot({ playerId: 'p3', name: 'Вика' }), 3_000), 'ROOM_FULL');
});

test('joinGame: после старта третьему игроку нет места', () => {
  const game = play(newPlayingGame(), HOST.playerId, 0);
  expectCode(() => joinGame(game, makeSlot({ playerId: 'p3', name: 'Вика' }), 3_000), 'ROOM_FULL');
});

test('checkWinner: все восемь линий', () => {
  for (const line of WIN_LINES) {
    const board: Cell[] = Array<Cell>(9).fill(null);
    for (const index of line) board[index] = 'X';
    const result = checkWinner(board);
    assert.ok(result, `линия ${line.join(',')} должна выигрывать`);
    assert.equal(result.winner, 'X');
    assert.deepEqual(result.line, [...line]);
  }
  assert.equal(checkWinner(Array<Cell>(9).fill(null)), null);
});

test('applyMove: X собирает верхнюю линию и партия закрывается', () => {
  let game = newPlayingGame();
  game = play(game, HOST.playerId, 0);
  game = play(game, GUEST.playerId, 3);
  game = play(game, HOST.playerId, 1);
  game = play(game, GUEST.playerId, 4);
  game = play(game, HOST.playerId, 2);

  assert.equal(game.status, 'finished');
  assert.equal(game.winner, 'X');
  assert.deepEqual(game.winningLine, [0, 1, 2]);
  assert.deepEqual(game.board.slice(0, 3), ['X', 'X', 'X']);
});

test('applyMove: ничья на заполненном поле', () => {
  let game = newPlayingGame();
  const moves: Array<[string, number]> = [
    [HOST.playerId, 0],
    [GUEST.playerId, 1],
    [HOST.playerId, 2],
    [GUEST.playerId, 4],
    [HOST.playerId, 3],
    [GUEST.playerId, 5],
    [HOST.playerId, 7],
    [GUEST.playerId, 6],
    [HOST.playerId, 8],
  ];
  for (const [playerId, index] of moves) {
    game = play(game, playerId, index);
  }

  assert.equal(game.status, 'finished');
  assert.equal(game.winner, 'draw');
  assert.equal(game.winningLine, null);
  assert.ok(isBoardFull(game.board));
});

test('applyMove: ход не в свою очередь', () => {
  const game = play(newPlayingGame(), HOST.playerId, 0);
  expectCode(() => play(game, HOST.playerId, 1), 'NOT_YOUR_TURN');
});

test('applyMove: занятая клетка', () => {
  const game = play(newPlayingGame(), HOST.playerId, 4);
  expectCode(() => play(game, GUEST.playerId, 4), 'CELL_TAKEN');
});

test('applyMove: устаревшая версия', () => {
  const game = newPlayingGame();
  expectCode(() => applyMove(game, { playerId: HOST.playerId, index: 0, version: 99 }, 3_000), 'STALE_STATE');
});

test('applyMove: некорректные индексы', () => {
  const game = newPlayingGame();
  for (const index of [-1, 9, 1.5, Number.NaN]) {
    expectCode(() => play(game, HOST.playerId, index), 'INVALID_INDEX');
  }
});

test('applyMove: ход третьего игрока', () => {
  const game = newPlayingGame();
  expectCode(() => play(game, 'p3', 0), 'NOT_IN_GAME');
});

test('applyMove: после финала ходы отклоняются', () => {
  let game = newPlayingGame();
  game = play(game, HOST.playerId, 0);
  game = play(game, GUEST.playerId, 3);
  game = play(game, HOST.playerId, 1);
  game = play(game, GUEST.playerId, 4);
  game = play(game, HOST.playerId, 2);
  expectCode(() => play(game, GUEST.playerId, 5), 'GAME_OVER');
});

test('applyMove: нельзя ходить до прихода соперника', () => {
  expectCode(() => play(newGame(), HOST.playerId, 0), 'GAME_NOT_ACTIVE');
});

test('startRematch: один голос не перезапускает партию', () => {
  let game = newPlayingGame();
  game = play(game, HOST.playerId, 0);
  game = play(game, GUEST.playerId, 3);
  game = play(game, HOST.playerId, 1);
  game = play(game, GUEST.playerId, 4);
  game = play(game, HOST.playerId, 2);

  const first = startRematch(game, HOST.playerId, 5_000);
  assert.equal(first.started, false);
  assert.equal(first.game.rematchVotes.length, 1);
  assert.equal(first.game.status, 'finished');

  const second = startRematch(first.game, GUEST.playerId, 5_500);
  assert.equal(second.started, true);
  assert.equal(second.game.status, 'playing');
  assert.equal(second.game.turn, 'X');
  assert.equal(second.game.winner, null);
  assert.equal(second.game.winningLine, null);
  assert.ok(second.game.board.every((cell) => cell === null));
  assert.deepEqual(second.game.rematchVotes, []);
  assert.equal(second.game.round, 2);
  assert.equal(toPublicGame(second.game).round, 2);
  assert.equal(markOf(second.game, HOST.playerId), 'O');
  assert.equal(markOf(second.game, GUEST.playerId), 'X');
});

test('startRematch: публичный снапшот отдаёт голоса метками', () => {
  let game = newPlayingGame();
  game = play(game, HOST.playerId, 0);
  game = play(game, GUEST.playerId, 3);
  game = play(game, HOST.playerId, 1);
  game = play(game, GUEST.playerId, 4);
  game = play(game, HOST.playerId, 2);

  const first = startRematch(game, HOST.playerId, 5_000);
  assert.deepEqual(toPublicGame(first.game).rematchVotes, ['X']);

  const second = startRematch(first.game, GUEST.playerId, 5_500);
  assert.deepEqual(toPublicGame(second.game).rematchVotes, []);
});

test('startRematch: недоступен в идущей партии', () => {
  expectCode(() => startRematch(newPlayingGame(), HOST.playerId, 3_000), 'GAME_NOT_ACTIVE');
});

test('startRematch: голос постороннего отклоняется', () => {
  let game = newPlayingGame();
  game = play(game, HOST.playerId, 0);
  game = play(game, GUEST.playerId, 3);
  game = play(game, HOST.playerId, 1);
  game = play(game, GUEST.playerId, 4);
  game = play(game, HOST.playerId, 2);
  expectCode(() => startRematch(game, 'p3', 5_000), 'NOT_IN_GAME');
});

test('sanitizeName: обрезает, схлопывает пробелы и отсекает пустые имена', () => {
  assert.equal(sanitizeName('  Аня   Иванова  '), 'Аня Иванова');
  assert.equal(sanitizeName('   '), null);
  assert.equal(sanitizeName(42), null);
  assert.equal(sanitizeName('x'.repeat(40)), 'x'.repeat(20));
  assert.equal(sanitizeName('a\u0000b'), 'a b');
});

test('toPublicGame: не отдаёт playerId', () => {
  const game = newPlayingGame();
  const pub = toPublicGame(game);
  const serialized = JSON.stringify(pub);
  assert.ok(!serialized.includes(HOST.playerId));
  assert.ok(!serialized.includes(GUEST.playerId));
  assert.equal(pub.players.X.name, 'Аня');
  assert.equal(pub.players.O?.name, 'Боб');
  assert.equal(pub.rematchVotes.length, 0);
});

test('public snapshot не мутируется при изменении игры', () => {
  let game = newPlayingGame();
  const pub = toPublicGame(game);
  game = play(game, HOST.playerId, 4);
  assert.equal(pub.board[4], null);
  assert.equal(pub.version, 1);
});

test('applyMove не мутирует исходный объект', () => {
  const game = newPlayingGame();
  const next = play(game, HOST.playerId, 0);
  assert.equal(game.board[0], null);
  assert.equal(next.board[0], 'X');
  assert.equal(game.version, 1);
  assert.equal(next.version, 2);
});

test('markOf: возвращает метку участника', () => {
  const game = newPlayingGame();
  assert.equal(markOf(game, HOST.playerId), 'X');
  assert.equal(markOf(game, GUEST.playerId), 'O');
  assert.equal(markOf(game, 'nobody'), null);
});

test('типы сообщений и метки', () => {
  const marks: Mark[] = ['X', 'O'];
  assert.deepEqual(marks, ['X', 'O']);
});
