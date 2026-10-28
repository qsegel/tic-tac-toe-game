import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import AuthView from './AuthView.vue';

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/auth', name: 'auth', component: AuthView },
      { path: '/profile', name: 'profile', component: { template: '<div />' } },
    ],
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AuthView', () => {
  it('отключает нативную валидацию и переключает режимы через aria-pressed', async () => {
    const router = createTestRouter();
    await router.push('/auth');
    const wrapper = mount(AuthView, { global: { plugins: [createPinia(), router] } });

    expect(wrapper.find('form.auth-form').attributes('novalidate')).toBeDefined();

    const tabs = wrapper.findAll('.auth-tabs__item');
    expect(tabs[0]?.attributes('aria-pressed')).toBe('true');
    expect(tabs[0]?.attributes('role')).toBeUndefined();

    await tabs[1]?.trigger('click');
    await flushPromises();
    expect(tabs[1]?.attributes('aria-pressed')).toBe('true');
    expect(router.currentRoute.value.query.mode).toBe('register');
  });

  it('после гостевого входа сохраняет имя и возвращает на redirect', async () => {
    const guest = {
      id: 'guest_1',
      email: null,
      name: 'Гость',
      guest: true,
      rating: null,
      createdAt: 0,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ user: guest }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const router = createTestRouter();
    await router.push('/auth?mode=guest&redirect=/profile');
    const wrapper = mount(AuthView, { global: { plugins: [createPinia(), router] } });

    await wrapper.find('input').setValue('Гость');
    await wrapper.find('form.auth-form').trigger('submit');
    await flushPromises();

    expect(localStorage.getItem('ttt:name')).toBe('Гость');
    expect(router.currentRoute.value.fullPath).toBe('/profile');
  });
});
