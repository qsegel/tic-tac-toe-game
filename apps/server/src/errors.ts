import type { FastifyReply } from 'fastify';
import type { ErrorCode, GameError } from '@ttt/shared';

/** HTTP-статус для каждого доменного кода ошибки. */
export const statusByCode: Partial<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  INVALID_TOKEN: 401,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  ACCOUNT_REQUIRED: 403,
  EMAIL_TAKEN: 409,
  WEAK_PASSWORD: 400,
  INVALID_EMAIL: 400,
  NOT_FOUND: 404,
  ROOM_FULL: 409,
  ROOM_LIMIT: 503,
  ALREADY_STARTED: 409,
  NOT_IN_GAME: 403,
  GAME_OVER: 409,
  GAME_NOT_ACTIVE: 409,
  NOT_ENOUGH_PLAYERS: 409,
  NOT_YOUR_TURN: 409,
  STALE_STATE: 409,
  CELL_TAKEN: 409,
  INVALID_INDEX: 400,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Единый формат ошибки API: `{ code, message }`. */
export function replyWithError(reply: FastifyReply, error: GameError): FastifyReply {
  return reply.code(statusByCode[error.code] ?? 400).send({ code: error.code, message: error.message });
}
