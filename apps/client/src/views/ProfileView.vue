<script setup lang="ts">
import type { MatchSummary, StatsResponse } from '@ttt/shared';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiError from '@/components/ui/UiError.vue';
import { ApiError, fetchMatches, fetchStats } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

const PAGE_SIZE = 20;

const router = useRouter();
const auth = useAuthStore();

const stats = ref<StatsResponse | null>(null);
const matches = ref<MatchSummary[]>([]);
const total = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);

const isGuest = computed(() => auth.isGuest);

const statCards = computed(() => {
  const value = stats.value;
  return [
    { label: 'Победы', value: value?.wins ?? 0, tone: 'win' },
    { label: 'Поражения', value: value?.losses ?? 0, tone: 'loss' },
    { label: 'Ничьи', value: value?.draws ?? 0, tone: 'draw' },
    { label: 'Брошено', value: value?.abandoned ?? 0, tone: 'muted' },
  ];
});

onMounted(() => {
  if (!isGuest.value) void load();
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [nextStats, nextMatches] = await Promise.all([fetchStats(), fetchMatches(PAGE_SIZE, 0)]);
    stats.value = nextStats;
    matches.value = nextMatches.matches;
    total.value = nextMatches.total;
    hasMore.value = nextMatches.hasMore;
  } catch (cause) {
    if (await handleAuthError(cause)) return;
    error.value = cause instanceof ApiError ? cause.message : 'Не удалось загрузить историю';
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (loadingMore.value) return;
  loadingMore.value = true;
  error.value = null;
  try {
    const next = await fetchMatches(PAGE_SIZE, matches.value.length);
    matches.value = [...matches.value, ...next.matches];
    total.value = next.total;
    hasMore.value = next.hasMore;
  } catch (cause) {
    if (await handleAuthError(cause)) return;
    error.value = cause instanceof ApiError ? cause.message : 'Не удалось загрузить историю';
  } finally {
    loadingMore.value = false;
  }
}

/** Истёкшая cookie: сбрасываем локального пользователя и уводим на вход. */
async function handleAuthError(cause: unknown): Promise<boolean> {
  if (!(cause instanceof ApiError) || cause.status !== 401) return false;
  auth.clear();
  await router.replace({ name: 'auth', query: { redirect: '/profile' } });
  return true;
}

function resultLabel(result: MatchSummary['result']): string {
  switch (result) {
    case 'win':
      return 'Победа';
    case 'loss':
      return 'Поражение';
    case 'draw':
      return 'Ничья';
    default:
      return 'Брошено';
  }
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}
</script>

<template>
  <main class="page page--profile">
    <header class="profile__head">
      <div>
        <h1 class="profile__title">Мои партии</h1>
        <p class="muted">
          {{ auth.user?.name ?? '' }}
          <template v-if="auth.isGuest"> · гость</template>
        </p>
      </div>
      <UiButton variant="ghost" @click="router.push({ name: 'home' })">← На главную</UiButton>
    </header>

    <UiCard v-if="isGuest">
      <h2 class="profile__subtitle">История доступна после регистрации</h2>
      <p class="muted">
        Гостевые партии не сохраняются. Создайте аккаунт, чтобы видеть результаты и статистику.
      </p>
      <UiButton block @click="router.push({ name: 'auth', query: { mode: 'register' } })">
        Зарегистрироваться
      </UiButton>
    </UiCard>

    <template v-else>
      <div class="stats">
        <div v-for="card in statCards" :key="card.label" class="stats__card" :class="`stats__card--${card.tone}`">
          <span class="stats__value">{{ card.value }}</span>
          <span class="stats__label">{{ card.label }}</span>
        </div>
      </div>

      <UiCard>
        <div class="profile__section-head">
          <h2 class="profile__subtitle">История</h2>
          <span v-if="total > 0" class="muted">Всего: {{ total }}</span>
        </div>

        <UiError :message="error" />

        <p v-if="loading" class="muted">Загружаем историю…</p>
        <p v-else-if="matches.length === 0" class="muted">
          Пока нет завершённых партий. Сыграйте первую!
        </p>
        <ul v-else class="history">
          <li v-for="match in matches" :key="match.id" class="history__item">
            <div class="history__main">
              <span class="history__code">{{ match.code }}</span>
              <span class="muted">раунд {{ match.round }}</span>
              <span class="history__result" :class="`history__result--${match.result}`">
                {{ resultLabel(match.result) }}
              </span>
            </div>
            <div class="history__meta">
              <span>против {{ match.opponentName ?? 'соперника' }}</span>
              <span>{{ formatDate(match.finishedAt) }}</span>
            </div>
          </li>
        </ul>

        <UiButton v-if="hasMore" variant="secondary" :loading="loadingMore" @click="loadMore">
          Показать ещё
        </UiButton>
      </UiCard>
    </template>
  </main>
</template>
