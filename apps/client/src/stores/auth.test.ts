import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './auth';

const user = {
  id: 'usr_1',
  email: 'anya@example.com',
  name: 'Аня',
  guest: false,
  createdAt: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('auth store', () => {
  it('при старте подхватывает пользователя из cookie', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ user })));

    const auth = useAuthStore();
    await auth.bootstrap();

    expect(auth.user).toEqual(user);
    expect(auth.ready).toBe(true);
  });

  it('при 401 считает пользователя неавторизованным', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ code: 'UNAUTHORIZED', message: 'Требуется вход' }, 401)),
    );

    const auth = useAuthStore();
    await auth.bootstrap();

    expect(auth.user).toBeNull();
    expect(auth.ready).toBe(true);
  });

  it('входит по email и паролю', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ user }));
    vi.stubGlobal('fetch', fetchSpy);

    const auth = useAuthStore();
    await auth.login('anya@example.com', 'password123');

    expect(auth.user).toEqual(user);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('входит гостем', async () => {
    const guest = { ...user, id: 'guest_1', email: null, guest: true, name: 'Гость' };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ user: guest })));

    const auth = useAuthStore();
    await auth.loginAsGuest('Гость');

    expect(auth.isGuest).toBe(true);
    expect(auth.user?.name).toBe('Гость');
  });

  it('очищает пользователя при выходе', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));

    const auth = useAuthStore();
    auth.user = user;
    await auth.logout();

    expect(auth.user).toBeNull();
  });
});
