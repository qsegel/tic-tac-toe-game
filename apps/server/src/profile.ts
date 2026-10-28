import type { FastifyInstance } from 'fastify';
import { GameError } from '@ttt/shared';
import type { LeaderboardResponse, MatchListResponse, StatsResponse } from '@ttt/shared';
import type { MatchHistory } from './history.js';

const matchesQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    offset: { type: 'integer', minimum: 0, maximum: 100_000 },
  },
} as const;

const leaderboardQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0, maximum: 100_000 },
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

  // Лидерборд доступен и гостям: это публичный рейтинг, без email и id.
  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    '/api/leaderboard',
    {
      schema: { querystring: leaderboardQuerySchema },
      preHandler: app.authenticate,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      const limit = request.query.limit ?? 20;
      const offset = request.query.offset ?? 0;
      const meId = request.authUser.guest ? null : request.authUser.id;
      return history.leaderboard(limit, offset, meId) satisfies LeaderboardResponse;
    },
  );
}

function requireAccount(guest: boolean): void {
  if (guest) {
    throw new GameError('ACCOUNT_REQUIRED', 'История доступна после регистрации');
  }
}
