import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import ProfileView from './ProfileView.vue';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/auth', name: 'auth', component: { template: '<div />' } },
      { path: '/leaderboard', name: 'leaderboard', component: { template: '<div />' } },
      { path: '/profile', name: 'profile', component: ProfileView },
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
    rating: 1016,
    createdAt: 0,
  };
  return pinia;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProfileView', () => {
  it('показывает рейтинг, форму и дельту в истории', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/me/stats')) {
          return jsonResponse({
            wins: 1,
            losses: 0,
            draws: 0,
            abandoned: 0,
            played: 1,
            rating: 1016,
            bestRating: 1016,
            ratedGames: 1,
            rank: 1,
          });
        }
        return jsonResponse({
          matches: [
            {
              id: 1,
              code: 'ABC234',
              round: 1,
              status: 'finished',
              winner: 'X',
              myMark: 'X',
              result: 'win',
              opponentName: 'Боб',
              rated: true,
              ratingDelta: 16,
              ratingAfter: 1016,
              finishedAt: 1_700_000_000_000,
            },
          ],
          total: 1,
          hasMore: false,
        });
      }),
    );

    const router = createTestRouter();
    await router.push('/profile');
    const wrapper = mount(ProfileView, { global: { plugins: [authenticatedPinia(), router] } });
    await flushPromises();

    const rating = wrapper.find('.stats--rating');
    expect(rating.text()).toContain('Рейтинг');
    expect(rating.text()).toContain('1016');
    expect(rating.text()).toContain('Лучший');

    expect(wrapper.find('.form__dot--win').exists()).toBe(true);
    expect(wrapper.find('.history__delta').text()).toBe('+16');
    expect(wrapper.text()).toContain('против Боб');
  });

  it('не дублирует партии при сдвиге offset между страницами', async () => {
    const match = (id: number, code: string) => ({
      id,
      code,
      round: 1,
      status: 'finished',
      winner: 'X',
      myMark: 'X',
      result: 'win',
      opponentName: 'Боб',
      rated: true,
      ratingDelta: 16,
      ratingAfter: 1016,
      finishedAt: 1_700_000_000_000,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/me/stats')) {
          return jsonResponse({
            wins: 2,
            losses: 0,
            draws: 0,
            abandoned: 0,
            played: 2,
            rating: 1032,
            bestRating: 1032,
            ratedGames: 2,
            rank: 1,
          });
        }

        const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
        const matches = offset === 0 ? [match(1, 'ABC234')] : [match(1, 'ABC234'), match(2, 'XYZ789')];
        return jsonResponse({ matches, total: 2, hasMore: offset === 0 });
      }),
    );

    const router = createTestRouter();
    await router.push('/profile');
    const wrapper = mount(ProfileView, { global: { plugins: [authenticatedPinia(), router] } });
    await flushPromises();

    await wrapper.findAll('button').find((button) => button.text().includes('Показать ещё'))!.trigger('click');
    await flushPromises();

    expect(wrapper.findAll('.history__item')).toHaveLength(2);
    expect(wrapper.text()).toContain('XYZ789');
  });
});
