<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import UiButton from '@/components/ui/UiButton.vue';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';

const router = useRouter();
const auth = useAuthStore();
const game = useGameStore();

const userLabel = computed(() => {
  if (!auth.user) return '';
  return auth.user.guest ? `${auth.user.name} · гость` : auth.user.name;
});

async function logout(): Promise<void> {
  if (game.session) {
    const playing = game.game?.status === 'playing';
    if (playing && !window.confirm('Партия ещё идёт. Выйти и засчитать победу сопернику?')) return;
    game.leave();
  }

  await auth.logout();
  await router.push({ name: 'home' });
}
</script>

<template>
  <div class="app">
    <header class="app__header">
      <RouterLink to="/" class="logo" aria-label="На главную">
        <span class="logo__x">X</span><span class="logo__o">O</span>
      </RouterLink>
      <span class="app__tagline">крестики-нолики онлайн</span>

      <nav class="app__user" aria-label="Аккаунт">
        <template v-if="auth.user">
          <RouterLink v-if="!auth.isGuest" to="/profile" class="app__user-name">{{ userLabel }}</RouterLink>
          <span v-else class="app__user-name app__user-name--guest">{{ userLabel }}</span>
          <RouterLink to="/leaderboard" class="app__nav-link">Рейтинг</RouterLink>
          <UiButton variant="ghost" @click="logout">Выйти</UiButton>
        </template>
        <RouterLink v-else to="/auth" class="app__login">Войти</RouterLink>
      </nav>
    </header>

    <RouterView />

    <footer class="app__footer">
      Два игрока, одна комната. Аккаунт или гость — на выбор.
    </footer>
  </div>
</template>
