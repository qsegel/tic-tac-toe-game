<script setup lang="ts">
import type { ConnectionState } from '@/stores/game';

defineProps<{ state: ConnectionState }>();
</script>

<template>
  <div v-if="state !== 'open'" class="banner" role="status" aria-live="polite">
    <span class="banner__dot" aria-hidden="true" />
    <span v-if="state === 'connecting'">Подключаемся к игре…</span>
    <span v-else-if="state === 'reconnecting'">Связь потеряна, переподключаемся…</span>
    <span v-else-if="state === 'closed'">Соединение закрыто</span>
    <span v-else>Ожидание соединения…</span>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.1);
  color: #fde68a;
  font-size: 0.86rem;
}

.banner__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fbbf24;
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .banner__dot {
    animation: none;
  }
}
</style>
