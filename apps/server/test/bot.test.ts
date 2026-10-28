import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type {
  AuthResponse,
  GameSessionResponse,
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

async function startServer(): Promise<Harness> {
  const app = await buildApp({
    logger: false,
    databasePath: ':memory:',
    jwtSecret: 'test-secret-0123456789-0123456789-0123456789',
    botDelayMs: 20,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

async function register(harness: Harness): Promise<string> {
  const response = await fetch(`${harness.baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `bot-${randomUUID()}@example.com`,
      password: 'password123',
      name: 'Игрок',
    }),
  });
  assert.equal(response.status, 201);
  await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

async function createBot(
  harness: Harness,
  cookie: string,
  difficulty = 'hard',
): Promise<{ status: number; body: GameSessionResponse | Record<string, unknown> }> {
  const response = await fetch(`${harness.baseUrl}/api/games/bot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ difficulty }),
  });
  const body = (await response.json()) as GameSessionResponse | Record<string, unknown>;
  return { status: response.status, body };
}

async function fetchGame(harness: Harness, code: string, cookie: string): Promise<PublicGame | null> {
  const response = await fetch(`${harness.baseUrl}/api/games/${encodeURIComponent(code)}`, {
    headers: { cookie },
  });
  if (response.status !== 200) return null;
  const body = (await response.json()) as { game: PublicGame };
  return body.game;
}

class SocketClient {
  private readonly socket: WebSocket;
  private state: PublicGame | null = null;
  private you: 'X' | 'O' | null = null;
  private error: string | null = null;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw: unknown) => {
      const message = JSON.parse(String(raw)) as ServerMessage;
      if (message.type === 'state') {
        this.state = message.game;
        this.you = message.you;
      } else if (message.type === 'error') {
        this.error = message.message;
      }
    });
  }

  static async connect(wsUrl: string, code: string, cookie: string): Promise<SocketClient> {
    const socket = new WebSocket(`${wsUrl}?code=${encodeURIComponent(code)}`, {
      headers: { cookie },
    });
    const client = new SocketClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return client;
  }

  get current(): PublicGame | null {
    return this.state;
  }

  get lastError(): string | null {
    return this.error;
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  async waitFor(
    predicate: (game: PublicGame) => boolean,
    timeoutMs = 3_000,
  ): Promise<PublicGame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.state && predicate(this.state)) return this.state;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Не дождались нужного состояния');
  }

  close(): void {
    this.socket.close();
  }
}

test('бот: создание партии и первый ход человека', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());
  const cookie = await register(harness);

  const created = await createBot(harness, cookie, 'hard');
  assert.equal(created.status, 201);
  const session = created.body as GameSessionResponse;
  assert.equal(session.mode, 'bot');
  assert.equal(session.mark, 'X');

  const client = await SocketClient.connect(harness.wsUrl, session.code, cookie);
  t.after(() => client.close());

  const initial = await client.waitFor((game) => game.status === 'playing');
  assert.equal(initial.mode, 'bot');
  assert.equal(initial.botDifficulty, 'hard');
  assert.equal(initial.players.O?.name, 'Бот');
  assert.equal(initial.players.O?.connected, true);
  assert.equal(initial.board.filter(Boolean).length, 0);

  client.send({ type: 'move', gameId: session.gameId, index: 0, version: initial.version });

  const afterBot = await client.waitFor((game) => game.board.filter(Boolean).length === 2);
  assert.equal(afterBot.board[0], 'X');
  assert.equal(afterBot.board.filter((cell) => cell === 'O').length, 1);
  assert.equal(afterBot.turn, 'X', 'после хода бота снова очередь человека');
});

test('бот: партия доигрывается, рематч меняет метки, история не пишется', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());
  const cookie = await register(harness);

  const session = (await createBot(harness, cookie, 'hard')).body as GameSessionResponse;
  const client = await SocketClient.connect(harness.wsUrl, session.code, cookie);
  t.after(() => client.close());

  let state = await client.waitFor((game) => game.status === 'playing');
  let guard = 0;

  while (state.status === 'playing' && guard < 20) {
    guard += 1;
    if (state.turn === 'X') {
      const index = state.board.findIndex((cell) => cell === null);
      assert.ok(index >= 0);
      client.send({ type: 'move', gameId: session.gameId, index, version: state.version });
    }
    const previous = state;
    state = await client.waitFor((game) => game.version > previous.version || game.status !== 'playing');
  }

  assert.equal(state.status, 'finished');

  const statsResponse = await fetch(`${harness.baseUrl}/api/me/stats`, { headers: { cookie } });
  const stats = (await statsResponse.json()) as StatsResponse;
  assert.equal(stats.played, 0, 'партия с ботом не попадает в историю');
  assert.equal(stats.ratedGames, 0, 'партия с ботом не влияет на рейтинг');

  client.send({ type: 'rematch' });

  const nextRound = await client.waitFor((game) => game.round === 2 && game.status === 'playing');
  assert.equal(nextRound.rematchVotes.length, 0);
  assert.equal(nextRound.board.filter(Boolean).length, 0, 'бот голосует сразу');
  assert.equal(nextRound.players.X?.name, 'Бот', 'после рематча метки меняются');
  assert.equal(nextRound.players.O?.name, 'Игрок');

  const botOpened = await client.waitFor((game) => game.board.filter(Boolean).length === 1);
  assert.equal(botOpened.board.filter((cell) => cell === 'X').length, 1, 'бот ходит первым');
});

test('бот: явный выход удаляет комнату', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());
  const cookie = await register(harness);

  const session = (await createBot(harness, cookie, 'easy')).body as GameSessionResponse;
  const client = await SocketClient.connect(harness.wsUrl, session.code, cookie);
  await client.waitFor((game) => game.status === 'playing');

  client.send({ type: 'leave' });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(await fetchGame(harness, session.code, cookie), null);
});

test('бот: гость может тренироваться, неверная сложность отклоняется', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const guestResponse = await fetch(`${harness.baseUrl}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Гость' }),
  });
  assert.equal(guestResponse.status, 200);
  const guest = (await guestResponse.json()) as AuthResponse;
  assert.equal(guest.user.guest, true);
  const cookie = guestResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const created = await createBot(harness, cookie, 'medium');
  assert.equal(created.status, 201);
  assert.equal((created.body as GameSessionResponse).mode, 'bot');

  const invalid = await createBot(harness, cookie, 'impossible');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'BAD_REQUEST');
});
