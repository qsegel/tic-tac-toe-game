import type { ErrorCode, Mark, PublicGame } from './types.js';

/** Сообщения от клиента к серверу. */
export type ClientMessage =
  | { type: 'move'; gameId: string; index: number; version: number }
  | { type: 'rematch' }
  | { type: 'leave' }
  | { type: 'ping' };

/** Сообщения от сервера к клиенту. */
export type ServerMessage =
  | { type: 'state'; game: PublicGame; you: Mark }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'pong' };

/** Тело ответа HTTP API при ошибке. */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
}

/** Ответ на создание/вход в игру. */
export interface GameSessionResponse {
  gameId: string;
  code: string;
  playerId: string;
  token: string;
  mark: Mark;
}
