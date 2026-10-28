<script setup lang="ts">
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
    block?: boolean;
  }>(),
  { variant: 'primary', type: 'button', disabled: false, loading: false, block: false },
);
</script>

<template>
  <button
    :type="type"
    :class="[$style[variant], { [$style.block]: block }]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <slot />
  </button>
</template>

<style module>
.primary {
  padding: 13px 18px;
  background: linear-gradient(120deg, var(--accent-strong), #8b5cf6);
  color: #fff;
  font-weight: 650;
  box-shadow: 0 12px 30px rgba(100, 116, 255, 0.3);
}

.primary:not(:disabled):hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.secondary {
  padding: 12px 18px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border);
  color: var(--text);
  font-weight: 600;
}

.secondary:not(:disabled):hover {
  background: rgba(255, 255, 255, 0.13);
}

.ghost {
  padding: 7px 12px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.82rem;
}

.ghost:hover {
  color: var(--text);
  border-color: rgba(255, 255, 255, 0.22);
}

.block {
  width: 100%;
}
</style>
