import { BOARD_SIZE } from './constants.js';
import { checkWinner, isBoardFull } from './game.js';
import type { BotDifficulty, Cell, Mark } from './types.js';

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'medium', 'hard'];

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

/**
 * Ход бота. Функция чистая: `random` можно подменить в тестах.
 *
 * - `easy` — случайная свободная клетка;
 * - `medium` — сначала побеждает или блокирует, затем в 60% случаев играет оптимально;
 * - `hard` — минимакс, идеальная игра.
 */
export function chooseBotMove(
  board: readonly Cell[],
  mark: Mark,
  difficulty: BotDifficulty,
  random: () => number = Math.random,
): number | null {
  const empty = emptyCells(board);
  if (empty.length === 0) return null;

  if (difficulty === 'easy') return pick(empty, random);
  if (difficulty === 'hard') return bestMove(board, mark, random);

  const winning = immediateWin(board, mark);
  if (winning !== null) return winning;

  const blocking = immediateWin(board, opponent(mark));
  if (blocking !== null) return blocking;

  return random() < 0.6 ? bestMove(board, mark, random) : pick(empty, random);
}

function bestMove(board: readonly Cell[], mark: Mark, random: () => number): number | null {
  let bestScore = -Infinity;
  let best: number[] = [];

  for (const index of emptyCells(board)) {
    const next = [...board];
    next[index] = mark;
    const score = minimax(next, opponent(mark), mark, 1);

    if (score > bestScore) {
      bestScore = score;
      best = [index];
    } else if (score === bestScore) {
      best.push(index);
    }
  }

  return best.length > 0 ? pick(best, random) : null;
}

/** Оценка позиции с точки зрения `maximizing`: быстрая победа ценнее медленной. */
function minimax(board: readonly Cell[], turn: Mark, maximizing: Mark, depth: number): number {
  const win = checkWinner(board);
  if (win) {
    return win.winner === maximizing ? 10 - depth : depth - 10;
  }
  if (isBoardFull(board)) return 0;

  const scores: number[] = [];
  for (const index of emptyCells(board)) {
    const next = [...board];
    next[index] = turn;
    scores.push(minimax(next, opponent(turn), maximizing, depth + 1));
  }

  return turn === maximizing ? Math.max(...scores) : Math.min(...scores);
}

function immediateWin(board: readonly Cell[], mark: Mark): number | null {
  for (const index of emptyCells(board)) {
    const next = [...board];
    next[index] = mark;
    const win = checkWinner(next);
    if (win && win.winner === mark) return index;
  }
  return null;
}

function emptyCells(board: readonly Cell[]): number[] {
  const cells: number[] = [];
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    if (!board[index]) cells.push(index);
  }
  return cells;
}

function pick(values: readonly number[], random: () => number): number {
  const position = Math.min(values.length - 1, Math.max(0, Math.floor(random() * values.length)));
  return values[position] ?? values[0]!;
}

function opponent(mark: Mark): Mark {
  return mark === 'X' ? 'O' : 'X';
}
