import type { FastifyInstance } from 'fastify';
import { toPublicGame } from '@ttt/shared';
import type { GameSessionResponse } from '@ttt/shared';
import type { RoomRegistry } from './rooms.js';

const codeParamsSchema = {
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 16 },
  },
} as const;

function sessionBody(result: {
  game: { id: string; code: string };
  playerId: string;
  mark: 'X' | 'O';
}): GameSessionResponse {
  return {
    gameId: result.game.id,
    code: result.game.code,
    playerId: result.playerId,
    mark: result.mark,
  };
}

export function registerRoutes(app: FastifyInstance, registry: RoomRegistry): void {
  app.get('/health', async () => ({ ok: true }));

  app.post(
    '/api/games',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const result = registry.create(request.authUser.id, request.authUser.name);
      return reply.code(201).send(sessionBody(result));
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/games/:code/join',
    {
      schema: { params: codeParamsSchema },
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const result = registry.join(request.params.code, request.authUser.id, request.authUser.name);
      return reply.code(201).send(sessionBody(result));
    },
  );

  app.get<{ Params: { code: string } }>(
    '/api/games/:code',
    {
      schema: { params: codeParamsSchema },
      preHandler: app.authenticate,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const game = registry.getByCode(request.params.code);
      if (!game) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Комната не найдена' });
      }
      return { game: toPublicGame(game) };
    },
  );
}
