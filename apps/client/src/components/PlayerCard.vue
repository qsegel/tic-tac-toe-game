<script setup lang="ts">
import type { Mark } from '@ttt/shared';
import { markTitle } from '@/lib/status';

withDefaults(
  defineProps<{
    name: string;
    mark: Mark | null;
    connected: boolean;
    active?: boolean;
    you?: boolean;
  }>(),
  { active: false, you: false },
);
</script>

<template>
  <div class="player" :class="{ 'player--active': active, 'player--offline': !connected }">
    <span class="player__mark" :class="mark ? `player__mark--${mark.toLowerCase()}` : ''">{{ mark ?? '·' }}</span>
    <span class="player__text">
      <span class="player__name">{{ name }}<em v-if="you"> · вы</em></span>
      <span class="player__meta">{{ connected ? markTitle(mark) : 'не в сети' }}</span>
    </span>
    <span
      class="player__dot"
      :class="{ 'player__dot--online': connected }"
      role="img"
      :aria-label="connected ? 'В сети' : 'Не в сети'"
      :title="connected ? 'В сети' : 'Не в сети'"
    />
  </div>
</template>

<style scoped>
.player {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
  min-width: 0;
}

.player--active {
  border-color: rgba(124, 140, 255, 0.55);
  background: rgba(124, 140, 255, 0.12);
  box-shadow: 0 0 24px rgba(124, 140, 255, 0.18);
}

.player--offline {
  opacity: 0.6;
}

.player__mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  font-weight: 700;
  font-size: 1.05rem;
}

.player__mark--x {
  color: var(--x);
}

.player__mark--o {
  color: var(--o);
}

.player__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.player__name {
  font-size: 0.92rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player__name em {
  font-style: normal;
  font-weight: 400;
  color: var(--muted);
}

.player__meta {
  font-size: 0.72rem;
  color: var(--muted);
}

.player__dot {
  width: 8px;
  height: 8px;
  margin-left: auto;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
}

.player__dot--online {
  background: #4ade80;
  box-shadow: 0 0 10px rgba(74, 222, 128, 0.7);
}
</style>
