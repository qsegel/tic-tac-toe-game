<script setup lang="ts">
import type { Cell, Mark } from '@ttt/shared';
import { cellLabel } from '@/lib/status';

const props = withDefaults(
  defineProps<{
    board: Cell[];
    disabled?: boolean;
    winningLine?: number[] | null;
    you?: Mark | null;
  }>(),
  { disabled: false, winningLine: null, you: null },
);

const emit = defineEmits<{ select: [index: number] }>();

function isWinning(index: number): boolean {
  return props.winningLine?.includes(index) ?? false;
}

function select(index: number): void {
  if (props.disabled) return;
  if (props.board[index]) return;
  emit('select', index);
}
</script>

<template>
  <div class="board" role="group" aria-label="Игровое поле">
    <button
      v-for="(cell, index) in board"
      :key="index"
      type="button"
      class="cell"
      :class="[
        cell ? `cell--${cell.toLowerCase()}` : '',
        { 'cell--win': isWinning(index), 'cell--locked': disabled },
      ]"
      :disabled="disabled || Boolean(cell)"
      :aria-label="cellLabel(cell, index)"
      @click="select(index)"
    >
      <span v-if="cell" class="cell__mark">{{ cell }}</span>
    </button>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
  min-height: 0;
  aspect-ratio: 1 / 1;
  padding: 10px;
  border-radius: calc(var(--radius) + 6px);
  background:
    radial-gradient(circle at 20% 10%, rgba(124, 140, 255, 0.16), transparent 55%),
    rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.cell {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
  color: var(--text);
  cursor: pointer;
  transition:
    transform 0.12s ease,
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.cell:not(:disabled):hover {
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
}

.cell:not(:disabled):active {
  transform: scale(0.97);
}

.cell:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.cell:disabled {
  cursor: default;
}

.cell--locked:not(.cell--win) {
  opacity: 0.72;
}

.cell__mark {
  font-size: clamp(2.2rem, 9vw, 4rem);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  animation: pop 0.18s ease-out;
}

.cell--x .cell__mark {
  color: var(--x);
  text-shadow: 0 0 22px rgba(94, 231, 255, 0.45);
}

.cell--o .cell__mark {
  color: var(--o);
  text-shadow: 0 0 22px rgba(255, 126, 182, 0.45);
}

.cell--win {
  border-color: rgba(255, 255, 255, 0.35);
  background: linear-gradient(160deg, rgba(124, 140, 255, 0.35), rgba(124, 140, 255, 0.08));
  box-shadow: 0 0 0 1px rgba(124, 140, 255, 0.4), 0 0 30px rgba(124, 140, 255, 0.35);
}

@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.6);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cell,
  .cell__mark {
    animation: none;
    transition: none;
  }
}
</style>
