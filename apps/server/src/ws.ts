import type { FastifyInstance } from 'fastify';
import {
  GameError,
  MOVE_RATE_LIMIT,
  MOVE_RATE_WINDOW_MS,
  WS_MESSAGE_RATE_LIMIT,
  WS_MESSAGE_RATE_WINDOW_MS,
  isClientMessage,
  toPublicGame,
} from '@ttt/shared';
import type { ClientMessage, ErrorCode, ServerMessage } from '@ttt/shared';
import type { WebSocket } from 'ws';
import type { AuthService } from './auth/session.js';
import { SESSION_COOKIE, readCookie } from './auth/session.js';
import type { AttachResult, RoomRegistry } from './rooms.js';

export interface WsOptions {
  /** Если список задан, подключение разрешено только с этих origin. */
  origins?: string[];
  /** Максимум одновременных сокетов с одного IP. */
  maxSocketsPerIp?: number;
}

const OPEN = 1;
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_REPLACED = 4001;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_BUFFERED_BYTES = 1_048_576;
const DEFAULT_MAX_SOCKETS_PER_IP = 8;

export function registerWs(
  app: FastifyInstance,
  registry: RoomRegistry,
  auth: AuthService,
  options: WsOptions = {},
): void {
  const sockets = new Map<string, WebSocket>();
  const socketsByIp = new Map<string, number>();
  const alive = new WeakMap<WebSocket, boolean>();
  const origins = (options.origins ?? []).map(normalizeOrigin).filter(Boolean);
  const maxSocketsPerIp = options.maxSocketsPerIp ?? DEFAULT_MAX_SOCKETS_PER_IP;

  registry.subscribe((game) => {
    const snapshot = toPublicGame(game);
    for (const mark of ['X', 'O'] as const) {
      const slot = game.players[mark];
      if (!slot) continue;
      const socket = sockets.get(socketKey(game.id, slot.playerId));
      if (!socket) continue;
      send(socket, { type: 'state', game: snapshot, you: mark });
    }
  });

  // Сервер сам проверяет живость соединения: без этого «мертвые» сокеты
  // держат игрока подключённым и блокируют abandon.
  const heartbeat = setInterval(() => {
    for (const socket of sockets.values()) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const socket of sockets.values()) {
      socket.terminate();
    }
    sockets.clear();
    socketsByIp.clear();
  });

  app.get('/ws', { websocket: true }, (socket, request) => {
    if (!originAllowed(request.headers.origin, origins)) {
      socket.close(CLOSE_POLICY_VIOLATION, 'origin-not-allowed');
      return;
    }

    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) {
      socket.close(CLOSE_POLICY_VIOLATION, 'unauthorized');
      return;
    }

    let user;
    try {
      user = auth.authenticateToken(token);
    } catch {
      socket.close(CLOSE_POLICY_VIOLATION, 'unauthorized');
      return;
    }

    const code = readCode(request.url);
    if (!code) {
      socket.close(CLOSE_POLICY_VIOLATION, 'code-required');
      return;
    }

    const ip = request.ip;
    const activeFromIp = socketsByIp.get(ip) ?? 0;
    if (activeFromIp >= maxSocketsPerIp) {
      socket.close(CLOSE_POLICY_VIOLATION, 'too-many-connections');
      return;
    }
    socketsByIp.set(ip, activeFromIp + 1);

    const releaseIpSlot = (): void => {
      const current = socketsByIp.get(ip) ?? 0;
      if (current <= 1) socketsByIp.delete(ip);
      else socketsByIp.set(ip, current - 1);
    };

    let attached: AttachResult;
    try {
      attached = registry.attach(code, user.id);
    } catch (error) {
      releaseIpSlot();
      const reason = error instanceof GameError ? error.code : 'unauthorized';
      socket.close(CLOSE_POLICY_VIOLATION, reason);
      return;
    }

    const gameId = attached.game.id;
    const playerId = attached.playerId;
    const key = socketKey(gameId, playerId);

    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));

    const previous = sockets.get(key);
    if (previous && previous !== socket) {
      sockets.delete(key);
      previous.close(CLOSE_REPLACED, 'replaced-by-new-session');
    }
    sockets.set(key, socket);

    send(socket, { type: 'state', game: toPublicGame(attached.game), you: attached.mark });

    let moveTimestamps: number[] = [];
    let messageTimestamps: number[] = [];

    socket.on('message', (raw: unknown) => {
      const now = Date.now();

      messageTimestamps = messageTimestamps.filter((stamp) => now - stamp < WS_MESSAGE_RATE_WINDOW_MS);
      if (messageTimestamps.length >= WS_MESSAGE_RATE_LIMIT) {
        sendError(socket, 'RATE_LIMITED', 'Слишком много сообщений, подождите секунду');
        return;
      }
      messageTimestamps.push(now);

      const payload = parseMessage(raw);
      if (!payload) {
        sendError(socket, 'BAD_REQUEST', 'Некорректное сообщение');
        return;
      }

      try {
        switch (payload.type) {
          case 'ping':
            send(socket, { type: 'pong' });
            break;

          case 'move': {
            moveTimestamps = moveTimestamps.filter((stamp) => now - stamp < MOVE_RATE_WINDOW_MS);
            if (moveTimestamps.length >= MOVE_RATE_LIMIT) {
              sendError(socket, 'RATE_LIMITED', 'Слишком много ходов, подождите секунду');
              return;
            }
            moveTimestamps.push(now);

            if (gameId !== payload.gameId) {
              sendError(socket, 'NOT_FOUND', 'Партия не найдена');
              return;
            }

            registry.move(gameId, playerId, payload.index, payload.version);
            break;
          }

          case 'rematch':
            registry.rematch(gameId, playerId);
            break;

          case 'leave':
            registry.leave(gameId, playerId);
            socket.close(1000, 'left');
            break;

          default:
            sendError(socket, 'BAD_REQUEST', 'Неизвестный тип сообщения');
        }
      } catch (error) {
        if (error instanceof GameError) {
          sendError(socket, error.code, error.message);
          return;
        }
        app.log.error({ err: error }, 'ws handler failed');
        sendError(socket, 'INTERNAL', 'Внутренняя ошибка сервера');
      }
    });

    socket.on('close', () => {
      releaseIpSlot();
      if (sockets.get(key) !== socket) return;
      sockets.delete(key);
      registry.detach(gameId, playerId);
    });

    socket.on('error', (error: Error) => {
      app.log.warn({ err: error }, 'ws error');
    });
  });
}

function socketKey(gameId: string, playerId: string): string {
  return `${gameId}:${playerId}`;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== OPEN) return;

  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.terminate();
    return;
  }

  try {
    socket.send(JSON.stringify(message));
  } catch {
    socket.terminate();
  }
}

function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
  send(socket, { type: 'error', code, message });
}

function parseMessage(raw: unknown): ClientMessage | null {
  let data: unknown;
  try {
    const text = typeof raw === 'string' ? raw : String(raw);
    data = JSON.parse(text);
  } catch {
    return null;
  }
  return isClientMessage(data) ? data : null;
}

function readCode(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'http://localhost').searchParams.get('code');
  } catch {
    return null;
  }
}

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, '');
  }
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (!origin) return false;
  return allowed.includes(normalizeOrigin(origin));
}
