import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
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
      { path: '/game/:code', name: 'game', component: { template: '<div />' } },
    ],
  });
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
    const wrapper = mount(HomeView, { global: { plugins: [createPinia(), router] } });
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
            playerId: 'player-1',
            token: 'token-1',
            mark: 'X',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const router = createTestRouter();
    await router.push('/');
    const wrapper = mount(HomeView, { global: { plugins: [createPinia(), router] } });

    await wrapper.find('input[autocomplete="nickname"]').setValue('Аня');
    await wrapper.find('form.create').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('game');
    expect(router.currentRoute.value.params.code).toBe('QWE234');
  });

  it('не отправляет запрос без имени', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const router = createTestRouter();
    await router.push('/');
    const wrapper = mount(HomeView, { global: { plugins: [createPinia(), router] } });

    await wrapper.find('form.create').trigger('submit');
    await flushPromises();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Введите имя');
  });
});
