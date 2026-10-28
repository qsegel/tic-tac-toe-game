<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import UiButton from '@/components/ui/UiButton.vue';
import UiError from '@/components/ui/UiError.vue';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';

const router = useRouter();
const auth = useAuthStore();
const game = useGameStore();

const logoutError = ref<string | null>(null);

const userLabel = computed(() => {
  if (!auth.user) return '';
  return auth.user.guest ? `${auth.user.name} · гость` : auth.user.name;
});

// Ошибка выхода относится к текущему экрану и не должна висеть после перехода.
watch(
  () => router.currentRoute.value.fullPath,
  () => {
    logoutError.value = null;
  },
);

async function logout(): Promise<void> {
  logoutError.value = null;

  let leaveGame = false;
  if (game.session) {
    const playing = game.game?.status === 'playing';
    const question = game.isBotGame
      ? 'Партия с ботом ещё идёт. Выйти?'
      : 'Партия ещё идёт. Выйти и засчитать победу сопернику?';
    if (playing && !window.confirm(question)) return;
    leaveGame = true;
  }

  // Сначала убеждаемся, что cookie действительно сброшена на сервере.
  // Иначе локальный выход выглядит успешным, а после перезагрузки пользователь снова в системе.
  if (!(await auth.logout())) {
    logoutError.value = auth.error ?? 'Не удалось выйти — проверьте соединение';
    return;
  }

  if (leaveGame) game.leave();
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
        <template v-if="auth.ready">
          <template v-if="auth.user">
            <RouterLink v-if="!auth.isGuest" to="/profile" class="app__user-name">{{ userLabel }}</RouterLink>
            <span v-else class="app__user-name app__user-name--guest">{{ userLabel }}</span>
            <RouterLink to="/leaderboard" class="app__nav-link">Рейтинг</RouterLink>
            <UiButton variant="ghost" :loading="auth.busy" @click="logout">Выйти</UiButton>
          </template>
          <RouterLink v-else to="/auth" class="app__login">Войти</RouterLink>
        </template>
      </nav>
    </header>

    <div v-if="logoutError" class="app__alert">
      <UiError :message="logoutError" />
    </div>

    <RouterView />

    <footer class="app__footer">
      Два игрока, одна комната. Аккаунт или гость — на выбор.
    </footer>
  </div>
</template>
