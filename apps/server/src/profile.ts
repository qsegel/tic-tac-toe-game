import type { FastifyInstance } from 'fastify';
import { GameError } from '@ttt/shared';
import type { MatchListResponse, StatsResponse } from '@ttt/shared';
import type { MatchHistory } from './history.js';

const matchesQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    offset: { type: 'integer', minimum: 0 },
  },
} as const;

export function registerProfileRoutes(app: FastifyInstance, history: MatchHistory): void {
  app.get(
    '/api/me/stats',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request) => {
      requireAccount(request.authUser.guest);
      return history.stats(request.authUser.id) satisfies StatsResponse;
    },
  );

  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    '/api/me/matches',
    {
      schema: { querystring: matchesQuerySchema },
      preHandler: app.authenticate,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request) => {
      requireAccount(request.authUser.guest);
      const limit = request.query.limit ?? 20;
      const offset = request.query.offset ?? 0;
      return history.list(request.authUser.id, limit, offset) satisfies MatchListResponse;
    },
  );
}

function requireAccount(guest: boolean): void {
  if (guest) {
    throw new GameError('ACCOUNT_REQUIRED', 'История доступна после регистрации');
  }
}
