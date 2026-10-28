import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '@/views/HomeView.vue';
import { useAuthStore } from '@/stores/auth';

const DEFAULT_TITLE = 'Крестики-нолики онлайн';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    {
      path: '/auth',
      name: 'auth',
      component: () => import('@/views/AuthView.vue'),
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/ProfileView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/game/:code',
      name: 'game',
      component: () => import('@/views/GameView.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.bootstrap();

  if (to.meta.requiresAuth && !auth.user) {
    return { name: 'auth', query: { redirect: to.fullPath } };
  }

  if (to.name === 'auth' && auth.user && !auth.isGuest) {
    return safeRedirect(to.query.redirect) ?? { name: 'home' };
  }

  return true;
});

router.afterEach((to) => {
  const code = typeof to.params.code === 'string' ? to.params.code.toUpperCase() : '';
  if (to.name === 'game' && code) {
    document.title = `Комната ${code} — крестики-нолики`;
  } else if (to.name === 'auth') {
    document.title = `Вход — ${DEFAULT_TITLE}`;
  } else if (to.name === 'profile') {
    document.title = `Мои партии — ${DEFAULT_TITLE}`;
  } else {
    document.title = DEFAULT_TITLE;
  }
});

/** Не даём увести редиректом на внешний сайт. */
export function safeRedirect(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // Браузеры трактуют обратный слэш как разделитель пути: `/\evil.com`
  // иначе превратился бы в `//evil.com`. Управляющие символы тоже отсекаем.
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}
