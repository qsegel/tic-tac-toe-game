import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AuthUser } from '@ttt/shared';
import {
  ApiError,
  fetchMe,
  login as apiLogin,
  loginAsGuest as apiGuest,
  logout as apiLogout,
  register as apiRegister,
} from '@/lib/api';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const ready = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);

  let bootstrapPromise: Promise<void> | null = null;

  const isGuest = computed(() => user.value?.guest === true);
  const isAuthenticated = computed(() => user.value !== null);

  /** Однократная проверка cookie при старте приложения. */
  function bootstrap(): Promise<void> {
    if (ready.value) return Promise.resolve();
    if (bootstrapPromise) return bootstrapPromise;

    bootstrapPromise = (async () => {
      try {
        const response = await fetchMe();
        user.value = response.user;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          user.value = null;
        } else {
          error.value = cause instanceof ApiError ? cause.message : 'Не удалось проверить сессию';
          user.value = null;
        }
      } finally {
        ready.value = true;
        bootstrapPromise = null;
      }
    })();

    return bootstrapPromise;
  }

  async function login(email: string, password: string): Promise<AuthUser> {
    return run(() => apiLogin({ email, password }));
  }

  async function register(input: { email: string; password: string; name: string }): Promise<AuthUser> {
    return run(() => apiRegister(input));
  }

  async function loginAsGuest(name: string): Promise<AuthUser> {
    return run(() => apiGuest(name));
  }

  async function run(action: () => Promise<{ user: AuthUser }>): Promise<AuthUser> {
    busy.value = true;
    error.value = null;
    try {
      const response = await action();
      user.value = response.user;
      ready.value = true;
      return response.user;
    } catch (cause) {
      error.value = cause instanceof ApiError ? cause.message : 'Не удалось выполнить вход';
      throw cause;
    } finally {
      busy.value = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiLogout();
    } catch {
      // даже если сервер недоступен, локально сессию сбрасываем
    } finally {
      user.value = null;
      ready.value = true;
      error.value = null;
    }
  }

  /** Локальный сброс после 401/истёкшей cookie. */
  function clear(): void {
    user.value = null;
    ready.value = true;
    error.value = null;
  }

  function setError(message: string | null): void {
    error.value = message;
  }

  return {
    user,
    ready,
    busy,
    error,
    isGuest,
    isAuthenticated,
    bootstrap,
    login,
    register,
    loginAsGuest,
    logout,
    clear,
    setError,
  };
});
