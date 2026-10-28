import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { GameError, MAX_MESSAGE_BYTES } from '@ttt/shared';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { replyWithError } from './errors.js';
import { RoomRegistry } from './rooms.js';
import { registerRoutes } from './routes.js';
import { registerWs } from './ws.js';

export interface BuildOptions {
  logger?: boolean;
  /** Белый список origin для CORS и WebSocket. Пусто = CORS выключен, Origin у WS не проверяется (dev). */
  clientOrigins?: string[];
  graceMs?: number;
  ttlMs?: number;
  maxRooms?: number;
  maxSocketsPerIp?: number;
  /** Доверять `X-Forwarded-*` (нужно за reverse-proxy для rate limit и логов). */
  trustProxy?: boolean;
  /** Каталог со собранным клиентом. `null` — не отдавать статику. */
  staticDir?: string | null;
  sweepIntervalMs?: number;
}

/** Убирает токен из URL, чтобы он не попадал в access-логи. */
export function redactToken(url: string | undefined): string | undefined {
  return url?.replace(/([?&]token=)[^&]*/g, '$1[redacted]');
}

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const clientOrigins = (options.clientOrigins ?? [])
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            serializers: {
              req: (request: FastifyRequest) => ({
                method: request.method,
                url: redactToken(request.url),
              }),
            },
          },
    bodyLimit: 8 * 1024,
    trustProxy: options.trustProxy ?? false,
  });

  const registry = new RoomRegistry({
    ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.maxRooms === undefined ? {} : { maxRooms: options.maxRooms }),
  });

  await app.register(cors, {
    origin: clientOrigins.length ? clientOrigins : false,
  });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      code: 'RATE_LIMITED',
      message: `Слишком много запросов, попробуйте через ${Math.max(1, Math.ceil(context.ttl / 1000))} с`,
      statusCode: 429,
    }),
  });
  await app.register(websocket, {
    options: { maxPayload: MAX_MESSAGE_BYTES },
  });

  registerRoutes(app, registry);
  registerWs(app, registry, {
    origins: clientOrigins,
    ...(options.maxSocketsPerIp === undefined ? {} : { maxSocketsPerIp: options.maxSocketsPerIp }),
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof GameError) {
      return replyWithError(reply, error);
    }

    const failure = error as { validation?: unknown; statusCode?: number };
    if (failure.validation) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Некорректный запрос' });
    }

    const status = failure.statusCode ?? 500;
    if (status === 429) {
      return reply.code(429).send({ code: 'RATE_LIMITED', message: 'Слишком много запросов, попробуйте позже' });
    }
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      return reply.code(500).send({ code: 'INTERNAL', message: 'Внутренняя ошибка сервера' });
    }
    return reply.code(status).send({ code: 'BAD_REQUEST', message: 'Некорректный запрос' });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (isApiPath(pathnameOf(request.raw.url))) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  const sweepTimer = setInterval(() => registry.sweep(), options.sweepIntervalMs ?? 60_000);
  sweepTimer.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(sweepTimer);
    registry.dispose();
  });

  const staticDir = options.staticDir === undefined ? defaultStaticDir() : options.staticDir;
  const serveStatic = staticDir !== null && existsSync(staticDir);

  if (serveStatic && staticDir) {
    await app.register(fastifyStatic, { root: staticDir, prefix: '/' });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = pathnameOf(request.raw.url);
    if (serveStatic && request.method === 'GET' && !isReservedPath(pathname) && !hasFileExtension(pathname)) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдено' });
  });

  return app;
}

function defaultStaticDir(): string | null {
  // apps/server/src/app.ts → ../../client/dist = apps/client/dist
  const candidate = fileURLToPath(new URL('../../client/dist', import.meta.url));
  return existsSync(candidate) ? candidate : null;
}

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, '');
  }
}

function pathnameOf(url: string | undefined): string {
  if (!url) return '/';
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isReservedPath(pathname: string): boolean {
  return isApiPath(pathname) || pathname === '/ws' || pathname === '/health';
}

function hasFileExtension(pathname: string): boolean {
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return lastSegment.includes('.');
}
