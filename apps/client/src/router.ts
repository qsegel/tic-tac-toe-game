import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '@/views/HomeView.vue';

const DEFAULT_TITLE = 'Крестики-нолики онлайн';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    {
      path: '/game/:code',
      name: 'game',
      component: () => import('@/views/GameView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.afterEach((to) => {
  const code = typeof to.params.code === 'string' ? to.params.code.toUpperCase() : '';
  document.title = to.name === 'game' && code ? `Комната ${code} — крестики-нолики` : DEFAULT_TITLE;
});
