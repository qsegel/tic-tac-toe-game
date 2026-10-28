import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { GameSessionResponse, Mark, PublicGame, ServerMessage } from '@ttt/shared';
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

async function startServer(options: HarnessOptions = {}): Promise<Harness> {
  const app = await buildApp({ logger: false, ...options });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

async function fetchGame(baseUrl: string, code: string): Promise<{ status: number; game?: PublicGame }> {
  const response = await fetch(`${baseUrl}/api/games/${encodeURIComponent(code)}`);
  if (response.status !== 200) return { status: response.status };
  const body = (await response.json()) as { game: PublicGame };
  return { status: 200, game: body.game };
}

async function waitForGame(
  baseUrl: string,
  code: string,
  predicate: (game: PublicGame) => boolean,
  timeoutMs = 2_000,
): Promise<PublicGame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fetchGame(baseUrl, code);
    if (result.status === 200 && result.game && predicate(result.game)) return result.game;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Подходящее состояние комнаты не получено');
}

async function waitForStatus(baseUrl: string, code: string, status: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fetchGame(baseUrl, code);
    if (result.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Комната не перешла в статус ${status}`);
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
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

function connect(wsUrl: string, token: string, options: { origin?: string } = {}): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${wsUrl}?token=${encodeURIComponent(token)}`,
      options.origin ? { origin: options.origin } : undefined,
    );
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

async function createPair(harness: Harness): Promise<{ host: GameSessionResponse; guest: GameSessionResponse }> {
  const created = await postJson(`${harness.baseUrl}/api/games`, { name: 'Аня' });
  assert.equal(created.status, 201);
  const host = created.body as unknown as GameSessionResponse;

  const joined = await postJson(`${harness.baseUrl}/api/games/${host.code}/join`, { name: 'Боб' });
  assert.equal(joined.status, 201);
  const guest = joined.body as unknown as GameSessionResponse;

  return { host, guest };
}

test('полный сценарий: создание, вход, победа X, рематч со сменой меток', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host, guest } = await createPair(harness);
  assert.equal(host.mark, 'X');
  assert.equal(guest.mark, 'O');
  assert.match(host.code, /^[A-Z0-9]{6}$/);

  const x = await connect(harness.wsUrl, host.token);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, guest.token);
  t.after(() => o.close());

  const initial = await x.stateWhere((game) => game.status === 'playing' && game.players.O?.connected === true);
  assert.equal(initial.you, 'X');
  assert.equal(initial.game.players.X.name, 'Аня');
  assert.equal(initial.game.players.O?.name, 'Боб');
  assert.equal(initial.game.turn, 'X');

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

  const publicResponse = await fetch(`${harness.baseUrl}/api/games/${host.code}`);
  assert.equal(publicResponse.status, 200);
  const publicBody = (await publicResponse.json()) as { game: PublicGame };
  assert.equal(publicBody.game.status, 'finished');
  assert.ok(!JSON.stringify(publicBody).includes(host.token), 'токен не должен утекать в публичный снапшот');
  assert.ok(!JSON.stringify(publicBody).includes(host.playerId), 'playerId не должен утекать');

  x.send({ type: 'rematch' });
  const oneVote = await x.stateWhere((game) => game.rematchVotes.length === 1);
  assert.deepEqual(oneVote.game.rematchVotes, ['X']);
  assert.equal(oneVote.game.status, 'finished');

  o.send({ type: 'rematch' });
  const restarted = await x.stateWhere((game) => game.status === 'playing' && game.version === version + 1);
  assert.equal(restarted.you, 'O', 'после рематча метки меняются');
  assert.equal(restarted.game.turn, 'X');
  assert.ok(restarted.game.board.every((cell) => cell === null));
});

test('третий игрок получает 409 ROOM_FULL', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host } = await createPair(harness);
  const third = await postJson(`${harness.baseUrl}/api/games/${host.code}/join`, { name: 'Вика' });
  assert.equal(third.status, 409);
  assert.equal(third.body.code, 'ROOM_FULL');
});

test('вход в несуществующую комнату → 404', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const result = await postJson(`${harness.baseUrl}/api/games/ZZZZZZ/join`, { name: 'Вика' });
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'NOT_FOUND');
});

test('ход не в свою очередь и устаревшая версия дают понятные ошибки', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host, guest } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, guest.token);
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

  const { host, guest } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, guest.token);

  await x.stateWhere((game) => game.players.O?.connected === true);
  o.close();

  const abandoned = await x.stateWhere((game) => game.status === 'abandoned');
  assert.equal(abandoned.game.winner, 'X');
});

test('переподключение по токену возвращает игрока в партию', async (t) => {
  const harness = await startServer({ graceMs: 1_000 });
  t.after(() => harness.app.close());

  const { host, guest } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, guest.token);

  await x.stateWhere((game) => game.players.O?.connected === true);
  o.close();
  await x.stateWhere((game) => game.players.O?.connected === false);

  const oAgain = await connect(harness.wsUrl, guest.token);
  t.after(() => oAgain.close());

  const restored = await x.stateWhere((game) => game.players.O?.connected === true);
  assert.equal(restored.game.status, 'playing');
});

test('невалидный токен закрывает сокет с кодом 1008', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const client = await connect(harness.wsUrl, 'not-a-real-token');
  const closed = await client.closed;
  assert.equal(closed.code, 1008);
});

test('неизвестный тип сообщения возвращает BAD_REQUEST', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  t.after(() => x.close());

  x.send({ type: 'teleport' });
  await x.errorWhere('BAD_REQUEST');
});

test('гость, не открывший сокет, не подвешивает партию', async (t) => {
  const harness = await startServer({ graceMs: 300 });
  t.after(() => harness.app.close());

  const { host } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  t.after(() => x.close());

  const abandoned = await x.stateWhere((game) => game.status === 'abandoned', 3_000);
  assert.equal(abandoned.game.winner, 'X', 'оставшийся игрок должен победить');
  assert.equal(abandoned.game.players.O?.connected, false);
});

test('если ушли оба — партия abandoned без победителя', async (t) => {
  const harness = await startServer({ graceMs: 100 });
  t.after(() => harness.app.close());

  const { host, guest } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  const o = await connect(harness.wsUrl, guest.token);
  await x.stateWhere((game) => game.players.O?.connected === true);

  x.close();
  o.close();

  const abandoned = await waitForGame(harness.baseUrl, host.code, (game) => game.status === 'abandoned');
  assert.equal(abandoned.winner, null, 'если не осталось никого, победителя быть не должно');
});

test('ошибки валидации приходят в едином формате', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const result = await postJson(`${harness.baseUrl}/api/games`, {});
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'BAD_REQUEST');
  assert.equal(result.body.message, 'Некорректный запрос');
});

test('429 приходит в едином формате', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  let last = await postJson(`${harness.baseUrl}/api/games`, { name: 'Аня' });
  for (let attempt = 0; attempt < 31 && last.status !== 429; attempt += 1) {
    last = await postJson(`${harness.baseUrl}/api/games`, { name: 'Аня' });
  }

  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'RATE_LIMITED');
  assert.equal(typeof last.body.message, 'string');
});

test('лимит комнат отдаёт 503 ROOM_LIMIT', async (t) => {
  const harness = await startServer({ maxRooms: 1 });
  t.after(() => harness.app.close());

  const first = await postJson(`${harness.baseUrl}/api/games`, { name: 'Аня' });
  assert.equal(first.status, 201);

  const second = await postJson(`${harness.baseUrl}/api/games`, { name: 'Боб' });
  assert.equal(second.status, 503);
  assert.equal(second.body.code, 'ROOM_LIMIT');
});

test('WebSocket проверяет Origin, если задан белый список', async (t) => {
  const harness = await startServer({ clientOrigins: ['http://allowed.test'] });
  t.after(() => harness.app.close());

  const { host } = await createPair(harness);
  const allowed = await connect(harness.wsUrl, host.token, { origin: 'http://allowed.test/' });
  t.after(() => allowed.close());
  const state = await allowed.stateWhere(() => true);
  assert.equal(state.you, 'X');

  const rejected = new WebSocket(`${harness.wsUrl}?token=${encodeURIComponent(host.token)}`, {
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

  const { host, guest } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  t.after(() => x.close());

  const extra = new WebSocket(`${harness.wsUrl}?token=${encodeURIComponent(guest.token)}`);
  extra.on('error', () => {
    // Ожидаемо: сервер закрывает соединение из-за лимита.
  });
  const closed = await new Promise<number>((resolve) => extra.once('close', (code: number) => resolve(code)));
  assert.equal(closed, 1008);
});

test('WebSocket ограничивает частоту сообщений', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  t.after(() => x.close());

  for (let index = 0; index < 35; index += 1) {
    x.send({ type: 'ping' });
  }
  await x.errorWhere('RATE_LIMITED');
});

test('явный выход из комнаты ожидания удаляет её', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const created = await postJson(`${harness.baseUrl}/api/games`, { name: 'Аня' });
  const host = created.body as unknown as GameSessionResponse;
  const x = await connect(harness.wsUrl, host.token);

  x.send({ type: 'leave' });
  await x.closed;

  const result = await fetchGame(harness.baseUrl, host.code);
  assert.equal(result.status, 404);
});

test('явный выход из идущей партии отдаёт победу сопернику', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const { host, guest } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  t.after(() => x.close());
  const o = await connect(harness.wsUrl, guest.token);
  t.after(() => o.close());

  await o.stateWhere((game) => game.status === 'playing');
  x.send({ type: 'leave' });

  const abandoned = await o.stateWhere((game) => game.status === 'abandoned');
  assert.equal(abandoned.game.winner, 'O');
});

test('sweep удаляет комнату, когда все отключились', async (t) => {
  const harness = await startServer({ graceMs: 50, ttlMs: 150, sweepIntervalMs: 20 });
  t.after(() => harness.app.close());

  const { host, guest } = await createPair(harness);
  const x = await connect(harness.wsUrl, host.token);
  const o = await connect(harness.wsUrl, guest.token);
  await x.stateWhere((game) => game.players.O?.connected === true);

  x.close();
  o.close();

  await waitForStatus(harness.baseUrl, host.code, 404, 1_500);
});
