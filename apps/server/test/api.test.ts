import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type {
  AuthResponse,
  AuthUser,
  GameSessionResponse,
  Mark,
  PublicGame,
  ServerMessage,
  StatsResponse,
} from '@ttt/shared';
import { buildApp } from '../src/app.js';

interface Harness {
  app: FastifyInstance;
  baseUrl: string;
  wsUrl: string;
}

interface HarnessOptions {
  graceMs?: number;
  ttlMs?: number;
  sweepIntervalMs?: number;
  maxRooms?: number;
  maxSocketsPerIp?: number;
  clientOrigins?: string[];
}

interface TestUser {
  user: AuthUser;
  cookie: string;
}

async function startServer(options: HarnessOptions = {}): Promise<Harness> {
  const app = await buildApp({
    logger: false,
    databasePath: ':memory:',
    jwtSecret: 'test-secret-0123456789-0123456789-0123456789',
    ...options,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

async function registerUser(harness: Harness, name: string): Promise<TestUser> {
  const response = await fetch(`${harness.baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `user-${randomUUID()}@example.com`,
      password: 'password123',
      name,
    }),
  });
  if (response.status !== 201) {
    throw new Error(`Не удалось зарегистрировать пользователя: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as AuthResponse;
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(cookie.startsWith('ttt_session='), 'сервер должен выставить cookie сессии');
  return { user: body.user, cookie };
}

async function postEmpty(url: string, cookie: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, { method: 'POST', headers: { cookie } });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function postJson(
  url: string,
  body: unknown,
  cookie?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function fetchGame(
  baseUrl: string,
  code: string,
  cookie: string,
): Promise<{ status: number; game?: PublicGame }> {
  const response = await fetch(`${baseUrl}/api/games/${encodeURIComponent(code)}`, {
    headers: { cookie },
  });
  if (response.status !== 200) return { status: response.status };
  const body = (await response.json()) as { game: PublicGame };
  return { status: 200, game: body.game };
}

async function waitForGame(
  baseUrl: string,
  code: string,
  cookie: string,
  predicate: (game: PublicGame) => boolean,
  timeoutMs = 2_000,
): Promise<PublicGame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fetchGame(baseUrl, code, cookie);
    if (result.status === 200 && result.game && predicate(result.game)) return result.game;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Подходящее состояние комнаты не получено');
}

async function waitForStatus(
  baseUrl: string,
  code: string,
  cookie: string,
  status: number,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fetchGame(baseUrl, code, cookie);
    if (result.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Комната не перешла в статус ${status}`);
}

class TestClient {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<(message: ServerMessage) => void> = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });

    this.closed = new Promise((resolve) => {
      socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
  }

  next(timeoutMs = 2_000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);

    return new Promise<ServerMessage>((resolve, reject) => {
      const handler = (message: ServerMessage) => {
        clearTimeout(timer);
        resolve(message);
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(handler);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('Таймаут ожидания WS-сообщения'));
      }, timeoutMs);
      this.waiters.push(handler);
    });
  }

  async stateWhere(
    predicate: (game: PublicGame) => boolean,
    timeoutMs = 2_000,
  ): Promise<{ game: PublicGame; you: Mark }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const message = await this.next(Math.max(50, deadline - Date.now()));
      if (message.type === 'state' && predicate(message.game)) {
        return { game: message.game, you: message.you };
      }
    }
    throw new Error('Подходящее состояние не пришло');
  }

  async errorWhere(code: string, timeoutMs = 2_000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const message = await this.next(Math.max(50, deadline - Date.now()));
      if (message.type === 'error' && message.code === code) return message;
    }
    throw new Error(`Ошибка ${code} не пришла`);
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }
}

function connect(
  wsUrl: string,
  code: string,
  cookie: string,
  options: { origin?: string } = {},
): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}?code=${encodeURIComponent(code)}`, {
      headers: { cookie },
      ...(options.origin ? { origin: options.origin } : {}),
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('WS не открылся'));
    }, 2_000);

    socket.once('open', () => {
      clearTimeout(timer);
      resolve(new TestClient(socket));
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function createRoom(harness: Harness, owner: TestUser): Promise<GameSessionResponse> {
  const created = await postEmpty(`${harness.baseUrl}/api/games`, owner.cookie);
  assert.equal(created.status, 201);
  return created.body as unknown as GameSessionResponse;
}

async function joinRoom(harness: Harness, code: string, user: TestUser): Promise<GameSessionResponse> {
  const joined = await postEmpty(`${harness.baseUrl}/api/games/${code}/join`, user.cookie);
  assert.equal(joined.status, 201);
  return joined.body as unknown as GameSessionResponse;
}

async function createPair(harness: Harness): Promise<{
  host: GameSessionResponse;
  guest: GameSessionResponse;
  hostUser: TestUser;
  guestUser: TestUser;
}> {
  const hostUser = await registerUser(harness, 'Аня');
  const guestUser = await registerUser(harness, 'Боб');
  const host = await createRoom(harness, hostUser);
  const guest = await joinRoom(harness, host.code, guestUser);
  return { host, guest, hostUser, guestUser };
}

test('полный сценарий: создание, вход, победа X, история и рематч со сменой меток', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host, guest, hostUser, guestUser } = await createPair(harness);
  assert.equal(host.mark, 'X');
  assert.equal(guest.mark, 'O');
  assert.match(host.code, /^[A-Z0-9]{6}$/);

  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, host.code, guestUser.cookie);
  t.after(() => o.close());

  const initial = await x.stateWhere((game) => game.status === 'playing' && game.players.O?.connected === true);
  assert.equal(initial.you, 'X');
  assert.equal(initial.game.players.X.name, 'Аня');
  assert.equal(initial.game.players.O?.name, 'Боб');
  assert.equal(initial.game.turn, 'X');
  assert.equal(initial.game.round, 1);

  let version = initial.game.version;
  let latest = initial.game;
  const script: Array<{ client: TestClient; index: number }> = [
    { client: x, index: 0 },
    { client: o, index: 3 },
    { client: x, index: 1 },
    { client: o, index: 4 },
    { client: x, index: 2 },
  ];

  for (const move of script) {
    move.client.send({ type: 'move', gameId: host.gameId, index: move.index, version });
    const state = await x.stateWhere((game) => game.version === version + 1);
    version = state.game.version;
    latest = state.game;
  }

  assert.equal(latest.status, 'finished');
  assert.equal(latest.winner, 'X');
  assert.deepEqual(latest.winningLine, [0, 1, 2]);

  const publicResponse = await fetch(`${harness.baseUrl}/api/games/${host.code}`, {
    headers: { cookie: hostUser.cookie },
  });
  assert.equal(publicResponse.status, 200);
  const publicBody = (await publicResponse.json()) as { game: PublicGame };
  assert.equal(publicBody.game.status, 'finished');
  assert.ok(!JSON.stringify(publicBody).includes(hostUser.user.id), 'userId не должен утекать');
  assert.ok(!JSON.stringify(publicBody).includes(guestUser.user.id), 'userId не должен утекать');

  const statsResponse = await fetch(`${harness.baseUrl}/api/me/stats`, {
    headers: { cookie: hostUser.cookie },
  });
  assert.equal(statsResponse.status, 200);
  const stats = (await statsResponse.json()) as StatsResponse;
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 0);
  assert.equal(stats.played, 1);

  x.send({ type: 'rematch' });
  const oneVote = await x.stateWhere((game) => game.rematchVotes.length === 1);
  assert.deepEqual(oneVote.game.rematchVotes, ['X']);
  assert.equal(oneVote.game.status, 'finished');

  o.send({ type: 'rematch' });
  const restarted = await x.stateWhere((game) => game.status === 'playing' && game.round === 2);
  assert.equal(restarted.you, 'O', 'после рематча метки меняются');
  assert.equal(restarted.game.turn, 'X');
  assert.ok(restarted.game.board.every((cell) => cell === null));
});

test('третий игрок получает 409 ROOM_FULL', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host } = await createPair(harness);
  const thirdUser = await registerUser(harness, 'Вика');
  const third = await postEmpty(`${harness.baseUrl}/api/games/${host.code}/join`, thirdUser.cookie);
  assert.equal(third.status, 409);
  assert.equal(third.body.code, 'ROOM_FULL');
});

test('вход в несуществующую комнату → 404', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const user = await registerUser(harness, 'Вика');
  const result = await postEmpty(`${harness.baseUrl}/api/games/ZZZZZZ/join`, user.cookie);
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'NOT_FOUND');
});

test('ход не в свою очередь и устаревшая версия дают понятные ошибки', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host, hostUser, guestUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, host.code, guestUser.cookie);
  t.after(() => o.close());

  const initial = await x.stateWhere((game) => game.status === 'playing' && game.players.O?.connected === true);
  const version = initial.game.version;

  x.send({ type: 'move', gameId: host.gameId, index: 0, version });
  await x.stateWhere((game) => game.version === version + 1);

  x.send({ type: 'move', gameId: host.gameId, index: 1, version: version + 1 });
  await x.errorWhere('NOT_YOUR_TURN');

  o.send({ type: 'move', gameId: host.gameId, index: 5, version: 999 });
  await o.errorWhere('STALE_STATE');

  o.send({ type: 'move', gameId: host.gameId, index: 0, version: version + 1 });
  await o.errorWhere('CELL_TAKEN');
});

test('обрыв связи отменяет партию после grace-периода', async (t) => {
  const harness = await startServer({ graceMs: 80 });
  t.after(() => harness.app.close());

  const { host, hostUser, guestUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, host.code, guestUser.cookie);

  await x.stateWhere((game) => game.players.O?.connected === true);
  o.close();

  const abandoned = await x.stateWhere((game) => game.status === 'abandoned');
  assert.equal(abandoned.game.winner, 'X');
});

test('переподключение по cookie возвращает игрока в партию', async (t) => {
  const harness = await startServer({ graceMs: 1_000 });
  t.after(() => harness.app.close());

  const { host, hostUser, guestUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, host.code, guestUser.cookie);

  await x.stateWhere((game) => game.players.O?.connected === true);
  o.close();
  await x.stateWhere((game) => game.players.O?.connected === false);

  const oAgain = await connect(harness.wsUrl, host.code, guestUser.cookie);
  t.after(() => oAgain.close());

  const restored = await x.stateWhere((game) => game.players.O?.connected === true);
  assert.equal(restored.game.status, 'playing');
});

test('без cookie или с невалидным JWT сокет закрывается с кодом 1008', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host } = await createPair(harness);

  const missing = new WebSocket(`${harness.wsUrl}?code=${host.code}`);
  missing.on('error', () => {});
  const missingClosed = await new Promise<{ code: number; reason: string }>((resolve) => {
    missing.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  assert.equal(missingClosed.code, 1008);
  assert.equal(missingClosed.reason, 'unauthorized');

  const invalid = new WebSocket(`${harness.wsUrl}?code=${host.code}`, {
    headers: { cookie: 'ttt_session=not-a-real-token' },
  });
  invalid.on('error', () => {});
  const invalidClosed = await new Promise<{ code: number; reason: string }>((resolve) => {
    invalid.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  assert.equal(invalidClosed.code, 1008);
  assert.equal(invalidClosed.reason, 'unauthorized');
});

test('неизвестный тип сообщения возвращает BAD_REQUEST', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host, hostUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  t.after(() => x.close());

  x.send({ type: 'teleport' });
  await x.errorWhere('BAD_REQUEST');
});

test('гость, не открывший сокет, не подвешивает партию', async (t) => {
  const harness = await startServer({ graceMs: 300 });
  t.after(() => harness.app.close());

  const { host, hostUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  t.after(() => x.close());

  const abandoned = await x.stateWhere((game) => game.status === 'abandoned', 3_000);
  assert.equal(abandoned.game.winner, 'X', 'оставшийся игрок должен победить');
  assert.equal(abandoned.game.players.O?.connected, false);
});

test('если ушли оба — партия abandoned без победителя', async (t) => {
  const harness = await startServer({ graceMs: 100 });
  t.after(() => harness.app.close());

  const { host, hostUser, guestUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  const o = await connect(harness.wsUrl, host.code, guestUser.cookie);
  await x.stateWhere((game) => game.players.O?.connected === true);

  x.close();
  o.close();

  const abandoned = await waitForGame(
    harness.baseUrl,
    host.code,
    hostUser.cookie,
    (game) => game.status === 'abandoned',
  );
  assert.equal(abandoned.winner, null, 'если не осталось никого, победителя быть не должно');
});

test('без авторизации игровые эндпоинты отвечают 401', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const result = await postEmpty(`${harness.baseUrl}/api/games`, '');
  assert.equal(result.status, 401);
  assert.equal(result.body.code, 'UNAUTHORIZED');
});

test('ошибки валидации приходят в едином формате', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const result = await postJson(`${harness.baseUrl}/api/auth/register`, { email: 'bad' });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'BAD_REQUEST');
  assert.equal(result.body.message, 'Некорректный запрос');
});

test('429 приходит в едином формате', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const user = await registerUser(harness, 'Аня');
  let last = await postEmpty(`${harness.baseUrl}/api/games`, user.cookie);
  for (let attempt = 0; attempt < 31 && last.status !== 429; attempt += 1) {
    last = await postEmpty(`${harness.baseUrl}/api/games`, user.cookie);
  }

  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'RATE_LIMITED');
  assert.equal(typeof last.body.message, 'string');
});

test('лимит комнат отдаёт 503 ROOM_LIMIT', async (t) => {
  const harness = await startServer({ maxRooms: 1 });
  t.after(() => harness.app.close());

  const user = await registerUser(harness, 'Аня');
  const first = await postEmpty(`${harness.baseUrl}/api/games`, user.cookie);
  assert.equal(first.status, 201);

  const second = await postEmpty(`${harness.baseUrl}/api/games`, user.cookie);
  assert.equal(second.status, 503);
  assert.equal(second.body.code, 'ROOM_LIMIT');
});

test('WebSocket проверяет Origin, если задан белый список', async (t) => {
  const harness = await startServer({ clientOrigins: ['http://allowed.test'] });
  t.after(() => harness.app.close());

  const { host, hostUser } = await createPair(harness);
  const allowed = await connect(harness.wsUrl, host.code, hostUser.cookie, { origin: 'http://allowed.test/' });
  t.after(() => allowed.close());
  const state = await allowed.stateWhere(() => true);
  assert.equal(state.you, 'X');

  const rejected = new WebSocket(`${harness.wsUrl}?code=${host.code}`, {
    headers: { cookie: hostUser.cookie },
    origin: 'http://evil.test',
  });
  rejected.on('error', () => {
    // Ожидаемо: сервер закрывает соединение до открытия.
  });
  const closed = await new Promise<number>((resolve) => rejected.once('close', (code: number) => resolve(code)));
  assert.equal(closed, 1008);
});

test('WebSocket ограничивает число соединений с одного IP', async (t) => {
  const harness = await startServer({ maxSocketsPerIp: 1 });
  t.after(() => harness.app.close());

  const { host, hostUser, guestUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  t.after(() => x.close());

  const extra = new WebSocket(`${harness.wsUrl}?code=${host.code}`, {
    headers: { cookie: guestUser.cookie },
  });
  extra.on('error', () => {
    // Ожидаемо: сервер закрывает соединение из-за лимита.
  });
  const closed = await new Promise<number>((resolve) => extra.once('close', (code: number) => resolve(code)));
  assert.equal(closed, 1008);
});

test('WebSocket ограничивает частоту сообщений', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host, hostUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  t.after(() => x.close());

  for (let index = 0; index < 35; index += 1) {
    x.send({ type: 'ping' });
  }
  await x.errorWhere('RATE_LIMITED');
});

test('явный выход из комнаты ожидания удаляет её', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const user = await registerUser(harness, 'Аня');
  const host = await createRoom(harness, user);
  const x = await connect(harness.wsUrl, host.code, user.cookie);

  x.send({ type: 'leave' });
  await x.closed;

  const result = await fetchGame(harness.baseUrl, host.code, user.cookie);
  assert.equal(result.status, 404);
});

test('комната ожидания удаляется после grace-периода, если хост не вернулся', async (t) => {
  const harness = await startServer({ graceMs: 50 });
  t.after(() => harness.app.close());

  const user = await registerUser(harness, 'Аня');
  const host = await createRoom(harness, user);
  const x = await connect(harness.wsUrl, host.code, user.cookie);

  x.close();

  await waitForStatus(harness.baseUrl, host.code, user.cookie, 404, 1_500);
});

test('явный выход из идущей партии отдаёт победу сопернику', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host, hostUser, guestUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, host.code, guestUser.cookie);
  t.after(() => o.close());

  await o.stateWhere((game) => game.status === 'playing');
  x.send({ type: 'leave' });

  const abandoned = await o.stateWhere((game) => game.status === 'abandoned');
  assert.equal(abandoned.game.winner, 'O');
});

test('sweep удаляет комнату, когда все отключились', async (t) => {
  const harness = await startServer({ graceMs: 50, ttlMs: 150, sweepIntervalMs: 20 });
  t.after(() => harness.app.close());

  const { host, hostUser, guestUser } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.code, hostUser.cookie);
  const o = await connect(harness.wsUrl, host.code, guestUser.cookie);
  await x.stateWhere((game) => game.players.O?.connected === true);

  x.close();
  o.close();

  await waitForStatus(harness.baseUrl, host.code, hostUser.cookie, 404, 1_500);
});
