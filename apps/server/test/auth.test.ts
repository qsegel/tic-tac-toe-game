import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { AuthResponse } from '@ttt/shared';
import { buildApp } from '../src/app.js';

interface Harness {
  app: FastifyInstance;
  baseUrl: string;
}

async function startServer(
  options: { clientOrigins?: string[]; cookieSecure?: boolean } = {},
): Promise<Harness> {
  const app = await buildApp({
    logger: false,
    databasePath: ':memory:',
    jwtSecret: 'test-secret-0123456789-0123456789-0123456789',
    ...options,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    setCookie: response.headers.get('set-cookie'),
  };
}

function cookieOf(setCookie: string | null): string {
  assert.ok(setCookie, 'ожидалась Set-Cookie');
  return setCookie.split(';')[0] ?? '';
}

test('регистрация выставляет httpOnly cookie и отдаёт пользователя', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const result = await post(`${harness.baseUrl}/api/auth/register`, {
    email: 'Anya@Example.com',
    password: 'password123',
    name: '  Аня  ',
  });

  assert.equal(result.status, 201);
  const user = (result.body as unknown as AuthResponse).user;
  assert.equal(user.email, 'anya@example.com');
  assert.equal(user.name, 'Аня');
  assert.equal(user.guest, false);
  assert.match(user.id, /^usr_/);

  const setCookie = result.setCookie ?? '';
  assert.match(setCookie, /ttt_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Max-Age=86400/i);
  assert.match(setCookie, /Path=\//i);

  const me = await fetch(`${harness.baseUrl}/api/auth/me`, { headers: { cookie: cookieOf(result.setCookie) } });
  assert.equal(me.status, 200);
  const meBody = (await me.json()) as AuthResponse;
  assert.equal(meBody.user.id, user.id);
});

test('дубликат email, слабый пароль и невалидный email отклоняются', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const first = await post(`${harness.baseUrl}/api/auth/register`, {
    email: 'anya@example.com',
    password: 'password123',
    name: 'Аня',
  });
  assert.equal(first.status, 201);

  const duplicate = await post(`${harness.baseUrl}/api/auth/register`, {
    email: 'ANYA@example.com',
    password: 'password123',
    name: 'Другая Аня',
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'EMAIL_TAKEN');

  const weak = await post(`${harness.baseUrl}/api/auth/register`, {
    email: 'weak@example.com',
    password: 'short',
    name: 'Слабый',
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.code, 'WEAK_PASSWORD');

  const invalid = await post(`${harness.baseUrl}/api/auth/register`, {
    email: 'not-an-email',
    password: 'password123',
    name: 'Без почты',
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'INVALID_EMAIL');
});

test('вход: неверный пароль даёт общий ответ, верный — cookie', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  await post(`${harness.baseUrl}/api/auth/register`, {
    email: 'anya@example.com',
    password: 'password123',
    name: 'Аня',
  });

  const wrong = await post(`${harness.baseUrl}/api/auth/login`, {
    email: 'anya@example.com',
    password: 'wrong-password',
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'INVALID_CREDENTIALS');

  const unknown = await post(`${harness.baseUrl}/api/auth/login`, {
    email: 'nobody@example.com',
    password: 'password123',
  });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.code, 'INVALID_CREDENTIALS');

  const ok = await post(`${harness.baseUrl}/api/auth/login`, {
    email: 'ANYA@example.com',
    password: 'password123',
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.setCookie);
});

test('выход очищает cookie', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const registered = await post(`${harness.baseUrl}/api/auth/register`, {
    email: 'anya@example.com',
    password: 'password123',
    name: 'Аня',
  });
  const response = await fetch(`${harness.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: cookieOf(registered.setCookie) },
  });
  assert.equal(response.status, 204);
  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /ttt_session=;/);
  assert.match(setCookie, /Max-Age=0/i);
});

test('гость может играть, но не видит статистику', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const guest = await post(`${harness.baseUrl}/api/auth/guest`, { name: 'Гость' });
  assert.equal(guest.status, 200);
  const user = (guest.body as unknown as AuthResponse).user;
  assert.equal(user.guest, true);
  assert.equal(user.email, null);
  assert.match(user.id, /^guest_/);

  const cookie = cookieOf(guest.setCookie);
  const created = await fetch(`${harness.baseUrl}/api/games`, { method: 'POST', headers: { cookie } });
  assert.equal(created.status, 201);

  const stats = await fetch(`${harness.baseUrl}/api/me/stats`, { headers: { cookie } });
  assert.equal(stats.status, 403);
  const body = (await stats.json()) as Record<string, unknown>;
  assert.equal(body.code, 'ACCOUNT_REQUIRED');
});

test('без cookie /api/auth/me отвечает 401', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const response = await fetch(`${harness.baseUrl}/api/auth/me`);
  assert.equal(response.status, 401);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.code, 'UNAUTHORIZED');
});

test('CSRF: небезопасный запрос с чужим Origin отклоняется', async (t) => {
  const harness = await startServer({ clientOrigins: ['http://allowed.test'] });
  t.after(() => harness.app.close());

  const registered = await post(`${harness.baseUrl}/api/auth/register`, {
    email: 'anya@example.com',
    password: 'password123',
    name: 'Аня',
  });
  const cookie = cookieOf(registered.setCookie);

  const evil = await fetch(`${harness.baseUrl}/api/games`, {
    method: 'POST',
    headers: { cookie, origin: 'http://evil.test' },
  });
  assert.equal(evil.status, 403);

  const allowed = await fetch(`${harness.baseUrl}/api/games`, {
    method: 'POST',
    headers: { cookie, origin: 'http://allowed.test' },
  });
  assert.equal(allowed.status, 201);
});

test('COOKIE_SECURE=true выставляет флаг Secure', async (t) => {
  const harness = await startServer({ cookieSecure: true });
  t.after(() => harness.app.close());

  const guest = await post(`${harness.baseUrl}/api/auth/guest`, { name: 'Гость' });
  assert.equal(guest.status, 200);
  assert.match(guest.setCookie ?? '', /;\s*Secure/i);
});

test('JWT: истёкший токен, чужой issuer и audience отклоняются', async (t) => {
  const harness = await startServer();
  t.after(() => harness.app.close());

  const registered = await post(`${harness.baseUrl}/api/auth/register`, {
    email: 'anya@example.com',
    password: 'password123',
    name: 'Аня',
  });
  const user = (registered.body as unknown as AuthResponse).user;

  const tokens = [
    harness.app.jwt.sign({ sub: user.id, role: 'user' }, { expiresIn: -1 }),
    harness.app.jwt.sign({ sub: user.id, role: 'user' }, { iss: 'evil' }),
    harness.app.jwt.sign({ sub: user.id, role: 'user' }, { aud: 'evil' }),
  ];

  for (const token of tokens) {
    const response = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { cookie: `ttt_session=${token}` },
    });
    assert.equal(response.status, 401);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.code, 'UNAUTHORIZED');
  }
});
