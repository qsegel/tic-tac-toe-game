<script setup lang="ts">
import { NAME_MAX_LENGTH } from '@ttt/shared';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiError from '@/components/ui/UiError.vue';
import UiInput from '@/components/ui/UiInput.vue';
import { loadName, saveName } from '@/lib/session';
import { safeRedirect } from '@/router';
import { useAuthStore } from '@/stores/auth';

type Mode = 'login' | 'register' | 'guest';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const mode = ref<Mode>(normalizeMode(route.query.mode));
const email = ref('');
const password = ref('');
const confirm = ref('');
const name = ref(loadName());
const localError = ref<string | null>(null);

const busy = computed(() => auth.busy);
const displayError = computed(() => localError.value ?? auth.error);
const redirect = computed(() => safeRedirect(route.query.redirect) ?? '/');

watch(
  () => route.query.mode,
  (value) => {
    mode.value = normalizeMode(value);
  },
);

function normalizeMode(value: unknown): Mode {
  return value === 'register' || value === 'guest' ? value : 'login';
}

function switchMode(next: Mode): void {
  if (mode.value === next) return;
  mode.value = next;
  localError.value = null;
  auth.setError(null);
  void router.replace({ query: { ...route.query, mode: next } });
}

async function submit(): Promise<void> {
  localError.value = null;
  auth.setError(null);

  const cleanName = name.value.trim();
  const cleanEmail = email.value.trim();

  if (mode.value === 'guest') {
    if (!cleanName) {
      localError.value = 'Введите имя';
      return;
    }
  } else if (mode.value === 'register') {
    if (!cleanName) {
      localError.value = 'Введите имя';
      return;
    }
    if (password.value.length < 8) {
      localError.value = 'Пароль должен быть не короче 8 символов';
      return;
    }
    if (password.value !== confirm.value) {
      localError.value = 'Пароли не совпадают';
      return;
    }
  }

  if (mode.value !== 'guest' && (!cleanEmail || !password.value)) {
    localError.value = 'Введите email и пароль';
    return;
  }

  try {
    if (mode.value === 'guest') {
      saveName(cleanName);
      await auth.loginAsGuest(cleanName);
    } else if (mode.value === 'register') {
      saveName(cleanName);
      await auth.register({ email: cleanEmail, password: password.value, name: cleanName });
    } else {
      await auth.login(cleanEmail, password.value);
    }
    await router.replace(redirect.value);
  } catch {
    // текст ошибки уже в auth.error
  }
}
</script>

<template>
  <main class="page page--auth">
    <section class="hero">
      <h1 class="hero__title">
        Крестики-нолики<br />
        <span class="hero__accent">онлайн на двоих</span>
      </h1>
      <p class="muted">
        Войдите, чтобы создавать комнаты и сохранять историю партий. Или сыграйте гостем — без регистрации.
      </p>
    </section>

    <UiCard>
      <div class="auth-tabs" role="tablist" aria-label="Способ входа">
        <button
          type="button"
          class="auth-tabs__item"
          :class="{ 'auth-tabs__item--active': mode === 'login' }"
          role="tab"
          :aria-selected="mode === 'login'"
          @click="switchMode('login')"
        >
          Вход
        </button>
        <button
          type="button"
          class="auth-tabs__item"
          :class="{ 'auth-tabs__item--active': mode === 'register' }"
          role="tab"
          :aria-selected="mode === 'register'"
          @click="switchMode('register')"
        >
          Регистрация
        </button>
        <button
          type="button"
          class="auth-tabs__item"
          :class="{ 'auth-tabs__item--active': mode === 'guest' }"
          role="tab"
          :aria-selected="mode === 'guest'"
          @click="switchMode('guest')"
        >
          Гостем
        </button>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <UiInput
          v-if="mode !== 'login'"
          v-model="name"
          label="Ваше имя"
          :maxlength="NAME_MAX_LENGTH"
          placeholder="Например, Аня"
          autocomplete="nickname"
        />

        <template v-if="mode !== 'guest'">
          <UiInput
            v-model="email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            inputmode="email"
            spellcheck="false"
          />
          <UiInput
            v-model="password"
            label="Пароль"
            type="password"
            :placeholder="mode === 'register' ? 'Минимум 8 символов' : 'Ваш пароль'"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
          />
          <UiInput
            v-if="mode === 'register'"
            v-model="confirm"
            label="Повторите пароль"
            type="password"
            placeholder="Ещё раз"
            autocomplete="new-password"
          />
        </template>

        <p v-if="mode === 'guest'" class="muted auth-note">
          Гостевая сессия живёт 24 часа, история и статистика не сохраняются. Позже можно зарегистрироваться.
        </p>

        <UiButton type="submit" block :loading="busy">
          <template v-if="mode === 'login'">Войти</template>
          <template v-else-if="mode === 'register'">Создать аккаунт</template>
          <template v-else>Играть как гость</template>
        </UiButton>
      </form>

      <UiError :message="displayError" />
    </UiCard>

    <p v-if="auth.isGuest" class="muted auth-note">
      Вы вошли гостем. Регистрация создаст отдельный аккаунт — текущая гостевая партия к нему не привяжется.
    </p>
  </main>
</template>
