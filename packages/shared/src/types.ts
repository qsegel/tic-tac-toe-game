export type Mark = 'X' | 'O';
export type Cell = Mark | null;

export type GameStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';
export type Winner = Mark | 'draw';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'INVALID_TOKEN'
  | 'ROOM_FULL'
  | 'ROOM_LIMIT'
  | 'ALREADY_STARTED'
  | 'NOT_IN_GAME'
  | 'NOT_ENOUGH_PLAYERS'
  | 'GAME_NOT_ACTIVE'
  | 'GAME_OVER'
  | 'NOT_YOUR_TURN'
  | 'STALE_STATE'
  | 'CELL_TAKEN'
  | 'INVALID_INDEX'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/**
 * Внутреннее представление игрока. `token` — секрет для переподключения,
 * он НИКОГДА не попадает в публичный снапшот (`toPublicGame`).
 */
export interface PlayerSlot {
  playerId: string;
  name: string;
  token: string;
  connected: boolean;
  disconnectedAt: number | null;
}

export interface Game {
  id: string;
  /** Человекочитаемый код комнаты, например `K7M2QX`. */
  code: string;
  board: Cell[];
  players: { X: PlayerSlot; O: PlayerSlot | null };
  turn: Mark;
  status: GameStatus;
  winner: Winner | null;
  winningLine: number[] | null;
  /** Инкремент на каждое изменение: защита от гонок и двойных кликов. */
  version: number;
  /** playerId-ы, нажавшие «ещё раз». */
  rematchVotes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PublicPlayer {
  name: string;
  connected: boolean;
}

/** Снапшот, который уходит клиентам. Без токенов и playerId. */
export interface PublicGame {
  id: string;
  code: string;
  board: Cell[];
  players: { X: PublicPlayer; O: PublicPlayer | null };
  turn: Mark;
  status: GameStatus;
  winner: Winner | null;
  winningLine: number[] | null;
  version: number;
  /** Метки игроков, нажавших «ещё раз»: клиент понимает, голосовал ли он сам. */
  rematchVotes: Mark[];
  createdAt: number;
}

/** Ошибка домена: код отдаётся клиенту, текст можно показывать как есть. */
export class GameError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}
