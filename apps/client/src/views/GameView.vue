<script setup lang="ts">
import { type Cell } from '@ttt/shared';
import type { BotDifficulty } from '@ttt/shared';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ConnectionBanner from '@/components/ConnectionBanner.vue';
import GameBoard from '@/components/GameBoard.vue';
import PlayerCard from '@/components/PlayerCard.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiError from '@/components/ui/UiError.vue';
import { ApiError } from '@/lib/api';
import { statusText, statusTone } from '@/lib/status';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';

const EMPTY_BOARD: Cell[] = Array<Cell>(9).fill(null);
const DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  easy: 'лёгкий',
  medium: 'средний',
  hard: 'сложный',
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const store = useGameStore();

const code = computed(() => String(route.params.code ?? '').toUpperCase());
const busy = ref(false);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const game = computed(() => store.game);
const needsJoin = computed(() => store.session === null);
const status = computed(() => statusText(game.value, store.you));
const tone = computed(() => statusTone(game.value, store.you));
const inviteLink = computed(() => `${window.location.origin}/game/${code.value}`);
const isBot = computed(() => store.isBotGame);
const opponentLabel = computed(() => {
  const name = store.opponent?.name ?? 'Ожидание';
  const difficulty = game.value?.botDifficulty;
  if (!isBot.value || !difficulty) return name;
  return `${name} · ${DIFFICULTY_LABELS[difficulty]}`;
});
const showRematch = computed(() => game.value?.status === 'finished');
const canVoteRematch = computed(() => store.connection === 'open' && !store.myRematchVote);
const round = computed(() => game.value?.round ?? 1);
const rematchLabel = computed(() => {
  if (store.connection !== 'open') return 'Нет соединения…';
  if (store.myRematchVote) return 'Ждём соперника…';
  if (store.opponentRematchVote) return 'Соперник готов — начать';
  return 'Играть ещё раз';
});

store.enter(code.value);

watch(code, (next) => store.enter(next));

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
  store.disconnect();
});

async function join(): Promise<void> {
  busy.value = true;
  try {
    await store.join(code.value);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) {
      await router.push({ name: 'auth', query: { redirect: route.fullPath } });
    }
  } finally {
    busy.value = false;
  }
}

async function copyInvite(): Promise<void> {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied.value = false;
      copiedTimer = null;
    }, 2_000);
  } catch {
    store.setError('Не удалось скопировать ссылку — выделите её вручную');
  }
}

function leave(): void {
  const playing = store.game?.status === 'playing';
  const question = isBot.value
    ? 'Партия с ботом ещё идёт. Выйти?'
    : 'Партия ещё идёт. Выйти и засчитать победу сопернику?';
  if (playing && !window.confirm(question)) return;
  store.leave();
  void router.push({ name: 'home' });
}
</script>

<template>
  <main class="page page--game">
    <header class="gamebar">
      <UiButton variant="ghost" @click="leave">← Выйти</UiButton>
      <span v-if="isBot" class="gamebar__code">
        Тренировка с ботом
        <template v-if="round > 1"> · раунд {{ round }}</template>
      </span>
      <span v-else class="gamebar__code">
        Комната <b>{{ code }}</b>
        <template v-if="round > 1"> · раунд {{ round }}</template>
      </span>
      <UiButton v-if="!isBot" variant="ghost" @click="copyInvite">
        {{ copied ? 'Скопировано ✓' : 'Ссылка' }}
      </UiButton>
    </header>

    <ConnectionBanner v-if="store.session" :state="store.connection" />

    <UiCard v-if="needsJoin" class="join-card">
      <h1 class="join-card__title">Присоединиться к игре</h1>
      <p class="muted">
        Комната <b>{{ code }}</b
        >. Вы войдёте как <b>{{ auth.user?.name ?? 'игрок' }}</b
        >.
      </p>
      <form class="join-card__form" @submit.prevent="join">
        <UiButton type="submit" :disabled="busy">{{ busy ? 'Входим…' : 'Войти в комнату' }}</UiButton>
      </form>
      <UiError :message="store.error" />
    </UiCard>

    <UiCard v-else class="game-card">
      <div class="players">
        <PlayerCard
          :name="store.me?.name ?? auth.user?.name ?? 'Вы'"
          :mark="store.you"
          :connected="store.me?.connected ?? false"
          :active="store.isMyTurn"
          you
        />
        <span class="players__vs">vs</span>
        <PlayerCard
          :name="opponentLabel"
          :mark="store.opponentMark"
          :connected="store.opponentOnline"
          :active="game?.status === 'playing' && !store.isMyTurn"
        />
      </div>

      <GameBoard
        :board="game?.board ?? EMPTY_BOARD"
        :disabled="!store.canPlay"
        :winning-line="game?.winningLine ?? null"
        :you="store.you"
        @select="store.play"
      />

      <p class="status" :class="`status--${tone}`" role="status" aria-live="polite">{{ status }}</p>

      <div v-if="store.waitingForOpponent && !isBot" class="invite">
        <span class="muted">Ссылка для друга</span>
        <code class="invite__link">{{ inviteLink }}</code>
      </div>

      <div v-if="showRematch" class="actions">
        <UiButton :disabled="!canVoteRematch" @click="store.voteRematch()">
          {{ rematchLabel }}
        </UiButton>
      </div>

      <UiError :message="store.error" />
    </UiCard>
  </main>
</template>
