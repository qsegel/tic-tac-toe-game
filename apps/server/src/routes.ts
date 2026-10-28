import type { FastifyInstance } from 'fastify';
import { sanitizeName, toPublicGame } from '@ttt/shared';
import type { GameSessionResponse } from '@ttt/shared';
import type { RoomRegistry } from './rooms.js';

const nameBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 20 },
  },
} as const;

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
  token: string;
  mark: 'X' | 'O';
}): GameSessionResponse {
  return {
    gameId: result.game.id,
    code: result.game.code,
    playerId: result.playerId,
    token: result.token,
    mark: result.mark,
  };
}

export function registerRoutes(app: FastifyInstance, registry: RoomRegistry): void {
  app.get('/health', async () => ({ ok: true }));

  app.post<{ Body: { name: string } }>(
    '/api/games',
    {
      schema: { body: nameBodySchema },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const name = sanitizeName(request.body.name);
      if (!name) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Введите имя' });
      }

      const result = registry.create(name);
      return reply.code(201).send(sessionBody(result));
    },
  );

  app.post<{ Params: { code: string }; Body: { name: string } }>(
    '/api/games/:code/join',
    {
      schema: { body: nameBodySchema, params: codeParamsSchema },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const name = sanitizeName(request.body.name);
      if (!name) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Введите имя' });
      }

      const result = registry.join(request.params.code, name);
      return reply.code(201).send(sessionBody(result));
    },
  );

  app.get<{ Params: { code: string } }>(
    '/api/games/:code',
    {
      schema: { params: codeParamsSchema },
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
