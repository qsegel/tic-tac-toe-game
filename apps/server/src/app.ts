import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { GameError, MAX_MESSAGE_BYTES } from '@ttt/shared';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { registerAuthRoutes } from './auth/routes.js';
import { AuthService, SESSION_COOKIE } from './auth/session.js';
import { UserStore } from './auth/users.js';
import { openDatabase } from './db.js';
import { replyWithError } from './errors.js';
import { MatchHistory, isSqliteBusy } from './history.js';
import { registerProfileRoutes } from './profile.js';
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
  /** Пауза перед ходом бота; в тестах можно выставить 0. */
  botDelayMs?: number;
  /** Доверять `X-Forwarded-*` (нужно за reverse-proxy для rate limit и логов). */
  trustProxy?: boolean;
  /** Каталог со собранным клиентом. `null` — не отдавать статику. */
  staticDir?: string | null;
  sweepIntervalMs?: number;
  /** Путь к SQLite. По умолчанию `:memory:` — удобно для тестов. */
  databasePath?: string;
  /** Секрет подписи JWT. Без него генерируется случайный (сессии не переживут рестарт). */
  jwtSecret?: string;
  /** Всегда ставить cookie с флагом Secure (за HTTPS reverse-proxy). */
  cookieSecure?: boolean;
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

  const db = openDatabase(options.databasePath ?? ':memory:');
  const users = new UserStore(db);
  const history = new MatchHistory(db);

  const registry = new RoomRegistry({
    ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.maxRooms === undefined ? {} : { maxRooms: options.maxRooms }),
    ...(options.botDelayMs === undefined ? {} : { botDelayMs: options.botDelayMs }),
  });

  await app.register(cookie);
  await app.register(jwt, {
    secret: options.jwtSecret ?? randomBytes(32).toString('hex'),
    sign: { expiresIn: '24h', iss: 'ttt', aud: 'ttt-web' },
    verify: { allowedIss: 'ttt', allowedAud: 'ttt-web' },
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });
  await app.register(cors, {
    origin: clientOrigins.length ? clientOrigins : false,
    credentials: true,
  });
  await app.register(rateLimit, {
    global: false,
  });
  await app.register(websocket, {
    options: { maxPayload: MAX_MESSAGE_BYTES },
  });

  const auth = new AuthService(app, users, { cookieSecure: options.cookieSecure });

  app.decorateRequest('authUser');
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.authUser = await auth.authenticateRequest(request);
  });

  registerAuthRoutes(app, auth);
  registerRoutes(app, registry);
  registerProfileRoutes(app, history);
  registerWs(app, registry, auth, {
    origins: clientOrigins,
    ...(options.maxSocketsPerIp === undefined ? {} : { maxSocketsPerIp: options.maxSocketsPerIp }),
  });

  // История пишется до рассылки снапшота: клиент, увидевший финал,
  // уже может открыть профиль и увидеть результат.
  let closing = false;

  registry.subscribe((game) => {
    const tryRecord = (attempt: number): void => {
      if (closing) return;
      try {
        history.record(game);
      } catch (error) {
        // SQLite может быть кратковременно занят (WAL, бэкап): повторяем,
        // иначе abandoned-раунд больше никогда не будет записан.
        if (!closing && attempt < 2 && isSqliteBusy(error)) {
          const timer = setTimeout(() => tryRecord(attempt + 1), 100 * (attempt + 1));
          timer.unref?.();
          return;
        }
        app.log.error(
          { err: error, gameId: game.id, round: game.round },
          'failed to record match',
        );
      }
    };
    tryRecord(0);
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
    if (status === 413) {
      return reply.code(413).send({ code: 'PAYLOAD_TOO_LARGE', message: 'Слишком большой запрос' });
    }
    if (status === 415) {
      return reply.code(415).send({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Неподдерживаемый тип содержимого' });
    }
    if (status === 429) {
      return reply.code(429).send({ code: 'RATE_LIMITED', message: 'Слишком много запросов, попробуйте позже' });
    }
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      return reply.code(500).send({ code: 'INTERNAL', message: 'Внутренняя ошибка сервера' });
    }
    return reply.code(status).send({ code: 'BAD_REQUEST', message: 'Некорректный запрос' });
  });

  // CSRF-защита в дополнение к SameSite=Lax: браузер присылает Origin
  // на небезопасные cross-origin запросы. Запросы без Origin (curl, тесты)
  // не ломаем — cookie у них всё равно нет.
  app.addHook('onRequest', async (request) => {
    if (clientOrigins.length === 0) return;
    if (!isApiPath(pathnameOf(request.raw.url))) return;
    if (!UNSAFE_METHODS.has(request.method)) return;

    const origin = request.headers.origin;
    if (!origin) return;
    if (!clientOrigins.includes(normalizeOrigin(origin))) {
      throw new GameError('FORBIDDEN', 'Запрос с недопустимого origin');
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    if (request.protocol === 'https' || options.cookieSecure === true) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    if (isApiPath(pathnameOf(request.raw.url))) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  const sweepTimer = setInterval(() => registry.sweep(), options.sweepIntervalMs ?? 60_000);
  sweepTimer.unref?.();

  app.addHook('onClose', async () => {
    closing = true;
    clearInterval(sweepTimer);
    registry.dispose();
    db.close();
  });

  const staticDir = options.staticDir === undefined ? defaultStaticDir() : options.staticDir;
  const serveStatic = staticDir !== null && existsSync(staticDir);

  if (staticDir && !serveStatic) {
    app.log.warn({ staticDir }, 'static directory not found; serving API only');
  }

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

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
