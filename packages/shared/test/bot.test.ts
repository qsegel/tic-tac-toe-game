import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBotMove, isBotDifficulty } from '../src/bot.js';
import { checkWinner, createBotGame, makeSlot, toPublicGame } from '../src/game.js';
import type { Cell, Mark } from '../src/types.js';

const EMPTY: Cell[] = Array<Cell>(9).fill(null);

function board(cells: Partial<Record<number, Mark>>): Cell[] {
  const next = [...EMPTY];
  for (const [index, mark] of Object.entries(cells)) {
    if (mark) next[Number(index)] = mark;
  }
  return next;
}

test('chooseBotMove: пустое поле и любая сложность дают легальный ход', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const index = chooseBotMove(EMPTY, 'O', difficulty, () => 0);
    assert.ok(index !== null && index >= 0 && index < 9, `сложность ${difficulty}`);
    assert.equal(EMPTY[index], null);
  }
});

test('chooseBotMove: на заполненном поле хода нет', () => {
  const full: Cell[] = ['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'O'];
  assert.equal(chooseBotMove(full, 'X', 'hard'), null);
});

test('chooseBotMove: hard завершает победную линию', () => {
  // O O _ / X X _ / _ _ _
  const cells = board({ 0: 'O', 1: 'O', 3: 'X', 4: 'X' });
  assert.equal(chooseBotMove(cells, 'O', 'hard'), 2);
});

test('chooseBotMove: hard блокирует немедленную победу соперника', () => {
  // X X _ / O _ _ / _ _ _
  const cells = board({ 0: 'X', 1: 'X', 3: 'O' });
  assert.equal(chooseBotMove(cells, 'O', 'hard'), 2);
});

test('chooseBotMove: medium сначала побеждает', () => {
  const cells = board({ 0: 'O', 1: 'O', 3: 'X', 4: 'X' });
  assert.equal(chooseBotMove(cells, 'O', 'medium', () => 0.99), 2);
});

test('chooseBotMove: medium блокирует, если не может выиграть', () => {
  const cells = board({ 0: 'X', 1: 'X', 3: 'O' });
  assert.equal(chooseBotMove(cells, 'O', 'medium', () => 0.99), 2);
});

test('chooseBotMove: hard не проигрывает, играя вторым', () => {
  assert.equal(humanCanWin(EMPTY, 'X', 'O'), false);
});

test('chooseBotMove: hard не проигрывает, играя первым', () => {
  assert.equal(humanCanWin(EMPTY, 'O', 'X'), false);
});

test('isBotDifficulty: принимает только известные сложности', () => {
  assert.equal(isBotDifficulty('easy'), true);
  assert.equal(isBotDifficulty('medium'), true);
  assert.equal(isBotDifficulty('hard'), true);
  assert.equal(isBotDifficulty('impossible'), false);
  assert.equal(isBotDifficulty(null), false);
});

test('createBotGame: партия сразу идёт, бот подключён и не раскрывается', () => {
  const game = createBotGame({
    id: 'bot-game',
    code: 'BOT234',
    host: makeSlot({ playerId: 'usr_1', name: 'Аня' }),
    botId: 'bot_1',
    botName: 'Бот',
    difficulty: 'hard',
    now: 1_000,
  });

  assert.equal(game.status, 'playing');
  assert.equal(game.mode, 'bot');
  assert.equal(game.botDifficulty, 'hard');
  assert.equal(game.players.O?.connected, true);
  assert.equal(game.players.O?.playerId, 'bot_1');
  assert.equal(game.turn, 'X');

  const snapshot = toPublicGame(game);
  assert.equal(snapshot.mode, 'bot');
  assert.equal(snapshot.botDifficulty, 'hard');
  assert.equal('botPlayerId' in snapshot, false);
  assert.equal('playerId' in snapshot.players.X, false);
  assert.equal('playerId' in (snapshot.players.O ?? {}), false);
});

/** Перебирает все ходы человека: может ли он хоть где-то выиграть у идеального бота. */
function humanCanWin(cells: Cell[], human: Mark, bot: Mark): boolean {
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]) continue;

    const afterHuman = [...cells];
    afterHuman[index] = human;
    const humanWin = checkWinner(afterHuman);
    if (humanWin && humanWin.winner === human) return true;
    if (afterHuman.every((cell) => cell !== null)) continue;

    const botIndex = chooseBotMove(afterHuman, bot, 'hard', () => 0);
    if (botIndex === null) continue;

    const afterBot = [...afterHuman];
    afterBot[botIndex] = bot;
    const botWin = checkWinner(afterBot);
    if (botWin && botWin.winner === bot) continue;

    if (humanCanWin(afterBot, human, bot)) return true;
  }

  return false;
}
