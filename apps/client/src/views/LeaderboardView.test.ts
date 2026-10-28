import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import LeaderboardView from './LeaderboardView.vue';

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/auth', name: 'auth', component: { template: '<div />' } },
      { path: '/profile', name: 'profile', component: { template: '<div />' } },
      { path: '/leaderboard', name: 'leaderboard', component: LeaderboardView },
    ],
  });
}

function mockLeaderboard(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LeaderboardView', () => {
  it('показывает таблицу и подсвечивает свою строку', async () => {
    mockLeaderboard({
      entries: [
        { position: 1, name: 'Аня', rating: 1016, games: 1, wins: 1, losses: 0, draws: 0, isMe: true },
        { position: 2, name: 'Боб', rating: 984, games: 1, wins: 0, losses: 1, draws: 0, isMe: false },
      ],
      total: 2,
      hasMore: false,
      me: { position: 1, name: 'Аня', rating: 1016, games: 1, wins: 1, losses: 0, draws: 0, isMe: true },
    });

    const router = createTestRouter();
    await router.push('/leaderboard');
    const wrapper = mount(LeaderboardView, { global: { plugins: [createPinia(), router] } });
    await flushPromises();

    expect(wrapper.findAll('.leaderboard__row')).toHaveLength(2);
    expect(wrapper.find('.leaderboard__row--me').text()).toContain('Аня');
    expect(wrapper.text()).toContain('1016');
    expect(wrapper.text()).toContain('984');
    expect(wrapper.find('.leaderboard__me').exists()).toBe(false);
  });

  it('показывает своё место, если оно вне страницы', async () => {
    mockLeaderboard({
      entries: [
        { position: 1, name: 'Аня', rating: 1100, games: 5, wins: 4, losses: 1, draws: 0, isMe: false },
      ],
      total: 30,
      hasMore: true,
      me: { position: 25, name: 'Боб', rating: 950, games: 3, wins: 1, losses: 2, draws: 0, isMe: true },
    });

    const router = createTestRouter();
    await router.push('/leaderboard');
    const wrapper = mount(LeaderboardView, { global: { plugins: [createPinia(), router] } });
    await flushPromises();

    expect(wrapper.find('.leaderboard__me').text()).toContain('#25');
    expect(wrapper.find('.leaderboard__me').text()).toContain('950');
    expect(wrapper.text()).toContain('Показать ещё');
  });

  it('показывает пустое состояние', async () => {
    mockLeaderboard({ entries: [], total: 0, hasMore: false, me: null });

    const router = createTestRouter();
    await router.push('/leaderboard');
    const wrapper = mount(LeaderboardView, { global: { plugins: [createPinia(), router] } });
    await flushPromises();

    expect(wrapper.text()).toContain('Пока никто не сыграл рейтинговую партию');
  });
});
