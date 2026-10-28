import { BOARD_SIZE, NAME_MAX_LENGTH, WIN_LINES } from './constants.js';
import { GameError } from './types.js';
import type { BotDifficulty, Cell, Game, Mark, PlayerSlot, PublicGame } from './types.js';

export function makeSlot(input: { playerId: string; name: string }): PlayerSlot {
  return {
    playerId: input.playerId,
    name: input.name,
    connected: false,
    disconnectedAt: null,
  };
}

export function createGame(input: { id: string; code: string; host: PlayerSlot; now: number }): Game {
  return {
    id: input.id,
    code: input.code,
    board: Array<Cell>(BOARD_SIZE).fill(null),
    players: { X: { ...input.host }, O: null },
    turn: 'X',
    status: 'waiting',
    winner: null,
    winningLine: null,
    version: 0,
    round: 1,
    rematchVotes: [],
    mode: 'pvp',
    botDifficulty: null,
    botPlayerId: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Партия с ботом: второй слот занят сразу, поэтому комната не ждёт игрока.
 * Бот считается подключённым — у него нет сокета, но и «бросить» партию он не может.
 */
export function createBotGame(input: {
  id: string;
  code: string;
  host: PlayerSlot;
  botId: string;
  botName: string;
  difficulty: BotDifficulty;
  now: number;
}): Game {
  const game = createGame({ id: input.id, code: input.code, host: input.host, now: input.now });
  return {
    ...game,
    players: {
      X: { ...input.host },
      O: {
        playerId: input.botId,
        name: input.botName,
        connected: true,
        disconnectedAt: null,
      },
    },
    status: 'playing',
    mode: 'bot',
    botDifficulty: input.difficulty,
    botPlayerId: input.botId,
    version: 1,
  };
}

function clone(game: Game): Game {
  return {
    ...game,
    board: [...game.board],
    players: {
      X: { ...game.players.X },
      O: game.players.O ? { ...game.players.O } : null,
    },
    rematchVotes: [...game.rematchVotes],
    winningLine: game.winningLine ? [...game.winningLine] : null,
  };
}

export function markOf(game: Game, playerId: string): Mark | null {
  if (game.players.X.playerId === playerId) return 'X';
  if (game.players.O?.playerId === playerId) return 'O';
  return null;
}

export function opponentOf(mark: Mark): Mark {
  return mark === 'X' ? 'O' : 'X';
}

export function checkWinner(board: readonly Cell[]): { winner: Mark; line: number[] } | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const first = board[a];
    if (first && first === board[b] && first === board[c]) {
      return { winner: first, line: [...line] };
    }
  }
  return null;
}

export function isBoardFull(board: readonly Cell[]): boolean {
  return board.every((cell) => cell !== null);
}

/** Второй игрок входит в комнату. Идемпотентно для уже вошедшего участника. */
export function joinGame(game: Game, guest: PlayerSlot, now: number): Game {
  if (markOf(game, guest.playerId)) return game;

  if (game.players.O) {
    throw new GameError('ROOM_FULL', 'В комнате уже два игрока');
  }
  if (game.status !== 'waiting') {
    throw new GameError('ALREADY_STARTED', 'Партия уже началась');
  }

  const next = clone(game);
  next.players.O = { ...guest };
  next.status = 'playing';
  next.turn = 'X';
  next.version += 1;
  next.updatedAt = now;
  return next;
}

/** Основной переход: сервер — единственный источник истины по ходам. */
export function applyMove(
  game: Game,
  input: { playerId: string; index: number; version: number },
  now: number,
): Game {
  if (game.status === 'finished' || game.status === 'abandoned') {
    throw new GameError('GAME_OVER', 'Партия уже завершена');
  }
  if (game.status !== 'playing') {
    throw new GameError('GAME_NOT_ACTIVE', 'Партия ещё не началась');
  }
  if (game.version !== input.version) {
    throw new GameError('STALE_STATE', 'Состояние устарело, обновите страницу');
  }

  const mark = markOf(game, input.playerId);
  if (!mark) {
    throw new GameError('NOT_IN_GAME', 'Вы не участник этой партии');
  }
  if (game.turn !== mark) {
    throw new GameError('NOT_YOUR_TURN', 'Сейчас ход соперника');
  }
  if (!Number.isInteger(input.index) || input.index < 0 || input.index >= BOARD_SIZE) {
    throw new GameError('INVALID_INDEX', 'Некорректная клетка');
  }
  if (game.board[input.index]) {
    throw new GameError('CELL_TAKEN', 'Клетка уже занята');
  }

  const next = clone(game);
  next.board[input.index] = mark;
  next.version += 1;
  next.updatedAt = now;

  const win = checkWinner(next.board);
  if (win) {
    next.status = 'finished';
    next.winner = win.winner;
    next.winningLine = win.line;
  } else if (isBoardFull(next.board)) {
    next.status = 'finished';
    next.winner = 'draw';
    next.winningLine = null;
  } else {
    next.turn = opponentOf(mark);
  }

  return next;
}

/**
 * Голос за рематч. Когда проголосовали оба — доска очищается,
 * а игроки меняются метками, чтобы первый ход доставался по очереди.
 */
export function startRematch(game: Game, playerId: string, now: number): { game: Game; started: boolean } {
  if (game.status === 'playing' || game.status === 'waiting') {
    throw new GameError('GAME_NOT_ACTIVE', 'Партия ещё не завершена');
  }
  if (!markOf(game, playerId)) {
    throw new GameError('NOT_IN_GAME', 'Вы не участник этой партии');
  }
  if (!game.players.O) {
    throw new GameError('NOT_ENOUGH_PLAYERS', 'Нужен второй игрок');
  }

  const next = clone(game);
  if (!next.rematchVotes.includes(playerId)) {
    next.rematchVotes.push(playerId);
  }
  next.updatedAt = now;

  if (next.rematchVotes.length < 2) {
    return { game: next, started: false };
  }

  const x = next.players.X;
  const o = game.players.O;
  if (!o) {
    throw new GameError('NOT_ENOUGH_PLAYERS', 'Нужен второй игрок');
  }
  next.players = { X: { ...o }, O: { ...x } };
  next.board = Array<Cell>(BOARD_SIZE).fill(null);
  next.status = 'playing';
  next.turn = 'X';
  next.winner = null;
  next.winningLine = null;
  next.rematchVotes = [];
  next.round += 1;
  next.version += 1;

  return { game: next, started: true };
}

/**
 * Управляющие символы, zero-width и bidi-override: их не должно быть в имени,
 * иначе ник в лидерборде/комнате может визуально «ломать» интерфейс.
 */
const NAME_FORBIDDEN = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Имя: обрезаем, схлопываем пробелы, убираем управляющие символы. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw
    .replace(NAME_FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Режем по code points, а не по UTF-16 code units: иначе эмодзи на границе
  // обрезается до одиночного суррогата и ломает JSON/рендер.
  const truncated = [...clean].slice(0, NAME_MAX_LENGTH).join('').trim();
  return truncated.length > 0 ? truncated : null;
}

export function toPublicGame(game: Game): PublicGame {
  return {
    id: game.id,
    code: game.code,
    board: [...game.board],
    players: {
      X: { name: game.players.X.name, connected: game.players.X.connected },
      O: game.players.O ? { name: game.players.O.name, connected: game.players.O.connected } : null,
    },
    turn: game.turn,
    status: game.status,
    winner: game.winner,
    winningLine: game.winningLine ? [...game.winningLine] : null,
    version: game.version,
    round: game.round,
    rematchVotes: game.rematchVotes.flatMap((playerId) => {
      const mark = markOf(game, playerId);
      return mark ? [mark] : [];
    }),
    mode: game.mode,
    botDifficulty: game.botDifficulty,
    createdAt: game.createdAt,
  };
}
