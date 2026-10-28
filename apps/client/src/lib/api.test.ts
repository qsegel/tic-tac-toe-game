import { afterEach, describe, expect, it, vi } from 'vitest';

/** Модуль читает `import.meta.env` при импорте, поэтому окружение подставляем до загрузки. */
async function loadApi() {
  vi.resetModules();
  return import('./api');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('api', () => {
  it('строит адрес сокета с кодом комнаты в верхнем регистре', async () => {
    const { websocketUrl } = await loadApi();
    const url = new URL(websocketUrl('abc234'));

    expect(url.protocol).toBe('ws:');
    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('code')).toBe('ABC234');
  });

  it('сохраняет wss для https- и wss-базы', async () => {
    vi.stubEnv('VITE_WS_URL', 'https://api.example.com');
    let api = await loadApi();
    expect(api.websocketUrl('ABC234')).toBe('wss://api.example.com/ws?code=ABC234');

    vi.unstubAllEnvs();
    vi.stubEnv('VITE_WS_URL', 'wss://api.example.com');
    api = await loadApi();
    expect(api.websocketUrl('ABC234')).toBe('wss://api.example.com/ws?code=ABC234');
  });

  it('не падает на некорректном VITE_WS_URL', async () => {
    vi.stubEnv('VITE_WS_URL', '::not-a-url');
    const { websocketUrl } = await loadApi();
    const url = new URL(websocketUrl('ABC234'));

    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('code')).toBe('ABC234');
  });

  it('убирает хвостовой слэш из VITE_API_URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com/');
    const api = await loadApi();
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ user: { id: 'usr_1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await api.login({ email: 'anya@example.com', password: 'password123' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/api/auth/login');
  });

  it('превращает ошибку сервера в ApiError с кодом и статусом', async () => {
    const api = await loadApi();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ code: 'INVALID_CREDENTIALS', message: 'Неверный пароль' }, 401)),
    );

    await expect(api.login({ email: 'anya@example.com', password: 'wrong' })).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INVALID_CREDENTIALS',
      message: 'Неверный пароль',
      status: 401,
    });
  });

  it('считает сетевую ошибку отдельным кодом', async () => {
    const api = await loadApi();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('failed to fetch');
      }),
    );

    await expect(api.fetchStats()).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('отклоняет успешный ответ с не-JSON телом', async () => {
    const api = await loadApi();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 200 })));

    await expect(api.login({ email: 'anya@example.com', password: 'password123' })).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
      status: 200,
    });
  });

  it('принимает пустой ответ 204', async () => {
    const api = await loadApi();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));

    await expect(api.logout()).resolves.toBeNull();
  });
});
