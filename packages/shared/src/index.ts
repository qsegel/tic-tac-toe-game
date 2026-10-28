import type { ClientMessage, ServerMessage } from './protocol.js';
import { BOARD_SIZE } from './constants.js';

export type {
  Cell,
  ErrorCode,
  Game,
  GameStatus,
  Mark,
  PlayerSlot,
  PublicGame,
  PublicPlayer,
  Winner,
} from './types.js';
export { GameError } from './types.js';

export {
  BOARD_SIZE,
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_MESSAGE_BYTES,
  MOVE_RATE_LIMIT,
  MOVE_RATE_WINDOW_MS,
  NAME_MAX_LENGTH,
  RECONNECT_GRACE_MS,
  ROOM_TTL_MS,
  WIN_LINES,
  WS_MESSAGE_RATE_LIMIT,
  WS_MESSAGE_RATE_WINDOW_MS,
  type WinLine,
} from './constants.js';

export {
  applyMove,
  checkWinner,
  createGame,
  isBoardFull,
  joinGame,
  makeSlot,
  markOf,
  opponentOf,
  sanitizeName,
  startRematch,
  toPublicGame,
} from './game.js';

export type { ApiErrorBody, ClientMessage, GameSessionResponse, ServerMessage } from './protocol.js';

/** Строгая проверка входящих сообщений: форма зависит от типа. */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;

  switch (message.type) {
    case 'ping':
    case 'leave':
    case 'rematch':
      return true;

    case 'move':
      return (
        typeof message.gameId === 'string' &&
        message.gameId.length > 0 &&
        typeof message.index === 'number' &&
        Number.isInteger(message.index) &&
        message.index >= 0 &&
        message.index < BOARD_SIZE &&
        typeof message.version === 'number' &&
        Number.isInteger(message.version) &&
        message.version >= 0
      );

    default:
      return false;
  }
}

/** Узкий type guard для исходящих сообщений (используется в тестах). */
export function isServerMessage(value: unknown): value is ServerMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
