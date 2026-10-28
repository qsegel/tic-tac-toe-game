<script setup lang="ts">
import type { LeaderboardEntry } from '@ttt/shared';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiError from '@/components/ui/UiError.vue';
import { ApiError, fetchLeaderboard } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

const PAGE_SIZE = 20;

const router = useRouter();
const auth = useAuthStore();

const entries = ref<LeaderboardEntry[]>([]);
const me = ref<LeaderboardEntry | null>(null);
const total = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);

const meOutsidePage = computed(() => me.value !== null && !entries.value.some((entry) => entry.isMe));

onMounted(() => void load());

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const page = await fetchLeaderboard(PAGE_SIZE, 0);
    entries.value = page.entries;
    me.value = page.me;
    total.value = page.total;
    hasMore.value = page.hasMore;
  } catch (cause) {
    if (await handleAuthError(cause)) return;
    error.value = cause instanceof ApiError ? cause.message : 'Не удалось загрузить рейтинг';
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (loadingMore.value) return;
  loadingMore.value = true;
  error.value = null;
  try {
    const page = await fetchLeaderboard(PAGE_SIZE, entries.value.length);
    const seen = new Set(entries.value.map((entry) => `${entry.position}-${entry.name}`));
    const merged = [...entries.value];
    for (const entry of page.entries) {
      const key = `${entry.position}-${entry.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
    entries.value = merged;
    me.value = page.me;
    total.value = page.total;
    hasMore.value = page.hasMore;
  } catch (cause) {
    if (await handleAuthError(cause)) return;
    error.value = cause instanceof ApiError ? cause.message : 'Не удалось загрузить рейтинг';
  } finally {
    loadingMore.value = false;
  }
}

async function handleAuthError(cause: unknown): Promise<boolean> {
  if (!(cause instanceof ApiError) || cause.status !== 401) return false;
  auth.clear();
  auth.setError('Сессия истекла — войдите снова');
  await router.replace({
    name: 'auth',
    query: { redirect: router.currentRoute.value.fullPath },
  });
  return true;
}
</script>

<template>
  <main class="page page--profile">
    <header class="profile__head">
      <div>
        <h1 class="profile__title">Рейтинг</h1>
        <p class="muted">Эло: победа и ничья меняют счёт, брошенные партии — нет.</p>
      </div>
      <div class="profile__head-actions">
        <UiButton variant="ghost" @click="router.push({ name: 'profile' })">Мои партии</UiButton>
        <UiButton variant="ghost" @click="router.push({ name: 'home' })">← На главную</UiButton>
      </div>
    </header>

    <UiCard>
      <div class="profile__section-head">
        <h2 class="profile__subtitle">Лучшие игроки</h2>
        <span v-if="total > 0" class="muted">Всего: {{ total }}</span>
      </div>

      <UiError :message="error" />

      <div v-if="meOutsidePage && me" class="leaderboard__me">
        <span class="muted">Ваше место</span>
        <b>#{{ me.position }}</b>
        <span class="leaderboard__rating">{{ me.rating }}</span>
      </div>

      <p v-if="loading" class="muted">Загружаем рейтинг…</p>
      <p v-else-if="entries.length === 0" class="muted">
        Пока никто не сыграл рейтинговую партию. Станьте первым!
      </p>
      <template v-else>
        <div class="leaderboard__head" aria-hidden="true">
          <span>#</span>
          <span>Игрок</span>
          <span>В–П–Н</span>
          <span>Рейтинг</span>
        </div>
        <ol class="leaderboard">
          <li
            v-for="entry in entries"
            :key="`${entry.position}-${entry.name}`"
            class="leaderboard__row"
            :class="{ 'leaderboard__row--me': entry.isMe }"
          >
            <span class="leaderboard__pos">{{ entry.position }}</span>
            <span class="leaderboard__name">
              {{ entry.name }}
              <span v-if="entry.isMe" class="leaderboard__you">вы</span>
            </span>
            <span class="leaderboard__record">{{ entry.wins }}–{{ entry.losses }}–{{ entry.draws }}</span>
            <b class="leaderboard__rating">{{ entry.rating }}</b>
          </li>
        </ol>

        <UiButton v-if="hasMore" variant="secondary" :loading="loadingMore" @click="loadMore">
          Показать ещё
        </UiButton>
      </template>

      <p v-if="auth.isGuest" class="muted">
        Вы играете гостем: партии не попадают в рейтинг.
        <RouterLink :to="{ name: 'auth', query: { mode: 'register', redirect: '/leaderboard' } }">
          Зарегистрироваться
        </RouterLink>
      </p>
    </UiCard>
  </main>
</template>
