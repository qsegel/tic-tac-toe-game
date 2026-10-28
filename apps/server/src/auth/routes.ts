import type { FastifyInstance } from 'fastify';
import { GameError, sanitizeName } from '@ttt/shared';
import type { AuthResponse } from '@ttt/shared';
import {
  AuthService,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
} from './session.js';

const registerBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password', 'name'],
  properties: {
    email: { type: 'string', maxLength: 254 },
    password: { type: 'string', maxLength: 128 },
    name: { type: 'string', maxLength: 20 },
  },
} as const;

const loginBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', maxLength: 254 },
    password: { type: 'string', maxLength: 128 },
  },
} as const;

const guestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', maxLength: 20 },
  },
} as const;

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  app.post<{ Body: { email: string; password: string; name: string } }>(
    '/api/auth/register',
    {
      schema: { body: registerBodySchema },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const email = normalizeEmail(request.body.email);
      if (!isValidEmail(email)) {
        throw new GameError('INVALID_EMAIL', 'Введите корректный email');
      }
      if (!isValidPassword(request.body.password)) {
        throw new GameError('WEAK_PASSWORD', 'Пароль должен быть от 8 до 128 символов');
      }
      const name = sanitizeName(request.body.name);
      if (!name) {
        throw new GameError('BAD_REQUEST', 'Введите имя');
      }

      const result = await auth.register({ email, password: request.body.password, name });
      auth.setCookie(reply, result.token, request);
      return reply.code(201).send({ user: result.user } satisfies AuthResponse);
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    {
      schema: { body: loginBodySchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const result = await auth.login({
        email: normalizeEmail(request.body.email),
        password: request.body.password,
      });
      auth.setCookie(reply, result.token, request);
      return reply.send({ user: result.user } satisfies AuthResponse);
    },
  );

  app.post<{ Body: { name: string } }>(
    '/api/auth/guest',
    {
      schema: { body: guestBodySchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const result = auth.guest(request.body.name);
      auth.setCookie(reply, result.token, request);
      return reply.send({ user: result.user } satisfies AuthResponse);
    },
  );

  app.post(
    '/api/auth/logout',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      auth.clearCookie(reply);
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/auth/me',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request) => ({ user: request.authUser }) satisfies AuthResponse,
  );
}
