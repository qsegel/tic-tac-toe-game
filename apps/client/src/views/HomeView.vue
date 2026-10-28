<script setup lang="ts">
import { CODE_ALPHABET, CODE_LENGTH } from '@ttt/shared';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiError from '@/components/ui/UiError.vue';
import UiInput from '@/components/ui/UiInput.vue';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';

const router = useRouter();
const auth = useAuthStore();
const store = useGameStore();

const code = ref('');
const busy = ref<'create' | 'join' | null>(null);

const userLabel = computed(() => {
  if (!auth.user) return '';
  return auth.user.guest ? `${auth.user.name} (гость)` : auth.user.name;
});

function normalizeCode(value: string): string {
  return value
    .toUpperCase()
    .split('')
    .filter((char) => CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, CODE_LENGTH);
}

function goAuth(mode: 'login' | 'register' | 'guest'): void {
  void router.push({
    name: 'auth',
    query: { mode, redirect: router.currentRoute.value.fullPath },
  });
}

function handleError(cause: unknown): void {
  if (cause instanceof ApiError && cause.status === 401) {
    goAuth('login');
  }
}

async function create(): Promise<void> {
  busy.value = 'create';
  try {
    const created = await store.create();
    await router.push({ name: 'game', params: { code: created } });
  } catch (cause) {
    handleError(cause);
  } finally {
    busy.value = null;
  }
}

async function join(): Promise<void> {
  if (code.value.length !== CODE_LENGTH) {
    store.setError(`Код комнаты состоит из ${CODE_LENGTH} символов`);
    return;
  }

  busy.value = 'join';
  try {
    await store.join(code.value);
    await router.push({ name: 'game', params: { code: code.value } });
  } catch (cause) {
    handleError(cause);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <main class="page">
    <section class="hero">
      <h1 class="hero__title">
        Крестики-нолики<br />
        <span class="hero__accent">онлайн на двоих</span>
      </h1>
      <p class="muted">
        Создайте комнату и отправьте ссылку другу. Партия начнётся сразу, как только он подключится.
      </p>
    </section>

    <UiCard v-if="!auth.user">
      <h2 class="home__title">Начнём?</h2>
      <p class="muted">
        Войдите в аккаунт, чтобы играть и сохранять историю, или зайдите гостем — без регистрации.
      </p>
      <div class="home__actions">
        <UiButton block @click="goAuth('login')">Войти</UiButton>
        <UiButton variant="secondary" block @click="goAuth('register')">Создать аккаунт</UiButton>
        <UiButton variant="ghost" block @click="goAuth('guest')">Играть как гость</UiButton>
      </div>
      <UiError :message="auth.error" />
    </UiCard>

    <template v-else>
      <UiCard>
        <div class="home__user">
          <span class="muted">Вы вошли как</span>
          <b>{{ userLabel }}</b>
        </div>

        <form class="create" @submit.prevent="create">
          <UiButton type="submit" :disabled="busy !== null">
            {{ busy === 'create' ? 'Создаём…' : 'Создать игру' }}
          </UiButton>
        </form>

        <div class="divider"><span>или</span></div>

        <form class="join" @submit.prevent="join">
          <UiInput
            v-model="code"
            label="Код комнаты"
            variant="code"
            :normalize="normalizeCode"
            placeholder="ABC234"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
          />
          <UiButton variant="secondary" type="submit" :disabled="busy !== null">
            {{ busy === 'join' ? 'Входим…' : 'Присоединиться' }}
          </UiButton>
        </form>

        <UiError :message="store.error" />
      </UiCard>

      <p v-if="auth.isGuest" class="muted home__guest">
        Вы играете гостем: история и статистика не сохраняются.
        <RouterLink to="/auth?mode=register">Зарегистрироваться</RouterLink>
      </p>
    </template>

    <ul class="hints">
      <li>Для игры вдвоём в одном браузере нужны два аккаунта или окно инкогнито.</li>
      <li>Короткий обрыв связи не прерывает партию — можно вернуться.</li>
    </ul>
  </main>
</template>
