import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import HomeView from './HomeView.vue';

class SilentSocket {
  static OPEN = 1;

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(): void {}

  close(): void {
    this.readyState = 3;
  }
}

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/auth', name: 'auth', component: { template: '<div />' } },
      { path: '/game/:code', name: 'game', component: { template: '<div />' } },
    ],
  });
}

function authenticatedPinia(): ReturnType<typeof createPinia> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = {
    id: 'usr_1',
    email: 'anya@example.com',
    name: 'Аня',
    guest: false,
    rating: 1000,
    createdAt: 0,
  };
  return pinia;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('WebSocket', SilentSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HomeView', () => {
  it('нормализует код комнаты при вводе', async () => {
    const router = createTestRouter();
    await router.push('/');
    const wrapper = mount(HomeView, { global: { plugins: [authenticatedPinia(), router] } });
    const codeInput = wrapper.find('input[placeholder="ABC234"]');

    await codeInput.setValue('abc-234');

    expect((codeInput.element as HTMLInputElement).value).toBe('ABC234');
  });

  it('создаёт игру по submit формы и уводит в комнату', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            gameId: 'game-1',
            code: 'QWE234',
            playerId: 'usr_1',
            mark: 'X',
            mode: 'pvp',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const router = createTestRouter();
    await router.push('/');
    const wrapper = mount(HomeView, { global: { plugins: [authenticatedPinia(), router] } });

    await wrapper.find('form.create').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('game');
    expect(router.currentRoute.value.params.code).toBe('QWE234');
  });

  it('при 401 очищает пользователя и уводит на вход', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Требуется вход' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const router = createTestRouter();
    await router.push('/');
    const pinia = authenticatedPinia();
    const wrapper = mount(HomeView, { global: { plugins: [pinia, router] } });

    await wrapper.find('form.create').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('auth');
    expect(router.currentRoute.value.query.redirect).toBe('/');
    expect(useAuthStore().user).toBeNull();
    expect(useAuthStore().error).toContain('Сессия');
  });

  it('запускает игру с ботом выбранной сложности', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            gameId: 'game-bot',
            code: 'BOT234',
            playerId: 'usr_1',
            mark: 'X',
            mode: 'bot',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const router = createTestRouter();
    await router.push('/');
    const wrapper = mount(HomeView, { global: { plugins: [authenticatedPinia(), router] } });

    const difficultyButtons = wrapper.findAll('.difficulty__item');
    expect(difficultyButtons).toHaveLength(3);
    await difficultyButtons[2]!.trigger('click');

    const startButton = wrapper.findAll('button').find((button) => button.text().includes('Играть с ботом'));
    expect(startButton).toBeDefined();
    await startButton!.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('game');
    expect(router.currentRoute.value.params.code).toBe('BOT234');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/games/bot');
    expect(JSON.parse(String(init?.body))).toEqual({ difficulty: 'hard' });
  });

  it('без авторизации показывает приглашение войти вместо форм', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const router = createTestRouter();
    await router.push('/');
    const wrapper = mount(HomeView, { global: { plugins: [createPinia(), router] } });

    expect(wrapper.find('form.create').exists()).toBe(false);
    expect(wrapper.text()).toContain('Создать аккаунт');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
