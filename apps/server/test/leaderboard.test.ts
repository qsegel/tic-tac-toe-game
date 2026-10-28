import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type {
  AuthResponse,
  GameSessionResponse,
  LeaderboardResponse,
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
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

async function register(harness: Harness, name: string): Promise<{ cookie: string; user: AuthResponse['user'] }> {
  const response = await fetch(`${harness.baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `lb-${randomUUID()}@example.com`, password: 'password123', name }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as AuthResponse;
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return { cookie, user: body.user };
}

async function createGame(harness: Harness, cookie: string): Promise<GameSessionResponse> {
  const response = await fetch(`${harness.baseUrl}/api/games`, { method: 'POST', headers: { cookie } });
  assert.equal(response.status, 201);
  return (await response.json()) as GameSessionResponse;
}

async function joinGame(harness: Harness, code: string, cookie: string): Promise<GameSessionResponse> {
  const response = await fetch(`${harness.baseUrl}/api/games/${code}/join`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(response.status, 201);
  return (await response.json()) as GameSessionResponse;
}

class Client {
  private readonly socket: WebSocket;
  state: PublicGame | null = null;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw: unknown) => {
      const message = JSON.parse(String(raw)) as ServerMessage;
      if (message.type === 'state') this.state = message.game;
    });
  }

  static async connect(wsUrl: string, code: string, cookie: string): Promise<Client> {
    const socket = new WebSocket(`${wsUrl}?code=${code}`, { headers: { cookie } });
    const client = new Client(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return client;
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  async waitFor(predicate: (game: PublicGame) => boolean, timeoutMs = 3_000): Promise<PublicGame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.state && predicate(this.state)) return this.state;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Не дождались состояния');
  }

  close(): void {
    this.socket.close();
  }
}

test('рейтинг: завершённая партия обновляет статистику и лидерборд', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const x = await register(harness, 'Аня');
  const o = await register(harness, 'Боб');
  assert.equal(x.user.rating, 1000, 'новый аккаунт стартует с 1000');

  const session = await createGame(harness, x.cookie);
  await joinGame(harness, session.code, o.cookie);

  const xClient = await Client.connect(harness.wsUrl, session.code, x.cookie);
  const oClient = await Client.connect(harness.wsUrl, session.code, o.cookie);
  t.after(() => {
    xClient.close();
    oClient.close();
  });

  let state = await xClient.waitFor((game) => game.status === 'playing');
  const moves: Array<[Client, number]> = [
    [xClient, 0],
    [oClient, 3],
    [xClient, 1],
    [oClient, 4],
    [xClient, 2],
  ];

  for (const [client, index] of moves) {
    state = await client.waitFor(
      (game) => game.status === 'playing' && game.turn === (client === xClient ? 'X' : 'O'),
    );
    client.send({ type: 'move', gameId: session.gameId, index, version: state.version });
  }

  const finished = await xClient.waitFor((game) => game.status === 'finished');
  assert.equal(finished.winner, 'X');

  const statsResponse = await fetch(`${harness.baseUrl}/api/me/stats`, { headers: { cookie: x.cookie } });
  const stats = (await statsResponse.json()) as StatsResponse;
  assert.equal(stats.rating, 1016);
  assert.equal(stats.ratedGames, 1);
  assert.equal(stats.rank, 1);

  const meResponse = await fetch(`${harness.baseUrl}/api/auth/me`, { headers: { cookie: x.cookie } });
  const me = (await meResponse.json()) as AuthResponse;
  assert.equal(me.user.rating, 1016, 'свежий рейтинг приходит в /api/auth/me');

  const boardResponse = await fetch(`${harness.baseUrl}/api/leaderboard?limit=10`, {
    headers: { cookie: o.cookie },
  });
  assert.equal(boardResponse.status, 200);
  const board = (await boardResponse.json()) as LeaderboardResponse;
  assert.equal(board.total, 2);
  assert.deepEqual(
    board.entries.map((entry) => [entry.position, entry.name, entry.rating, entry.isMe]),
    [
      [1, 'Аня', 1016, false],
      [2, 'Боб', 984, true],
    ],
  );
  assert.equal(board.me?.position, 2);

  const matchResponse = await fetch(`${harness.baseUrl}/api/me/matches`, { headers: { cookie: x.cookie } });
  const matches = (await matchResponse.json()) as { matches: Array<{ rated: boolean; ratingDelta: number | null }> };
  assert.equal(matches.matches[0]?.rated, true);
  assert.equal(matches.matches[0]?.ratingDelta, 16);
});
