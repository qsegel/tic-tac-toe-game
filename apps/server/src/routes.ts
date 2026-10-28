import type { FastifyInstance } from 'fastify';
import { BOT_DIFFICULTIES, toPublicGame } from '@ttt/shared';
import type { BotDifficulty, GameSessionResponse } from '@ttt/shared';
import type { RoomRegistry } from './rooms.js';

const codeParamsSchema = {
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 16 },
  },
} as const;

const botBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    difficulty: { type: 'string', enum: [...BOT_DIFFICULTIES] },
  },
} as const;

function sessionBody(result: {
  game: { id: string; code: string; mode: GameSessionResponse['mode'] };
  playerId: string;
  mark: 'X' | 'O';
}): GameSessionResponse {
  return {
    gameId: result.game.id,
    code: result.game.code,
    playerId: result.playerId,
    mark: result.mark,
    mode: result.game.mode,
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

  app.post<{ Body: { difficulty?: BotDifficulty } }>(
    '/api/games/bot',
    {
      schema: { body: botBodySchema },
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const difficulty = request.body?.difficulty ?? 'medium';
      const result = registry.createBot(request.authUser.id, request.authUser.name, difficulty);
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
      // Повторный заход того же игрока — не создание нового слота.
      return reply.code(result.created ? 201 : 200).send(sessionBody(result));
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
