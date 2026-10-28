<script setup lang="ts">
import { useId } from 'vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    variant?: 'text' | 'code';
    /** Очистка/нормализация значения до записи в v-model. */
    normalize?: (value: string) => string;
  }>(),
  { label: '', variant: 'text', normalize: (value: string) => value },
);

const model = defineModel<string>({ default: '' });
const id = useId();

defineOptions({ inheritAttrs: false });

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const next = props.normalize(input.value);
  if (input.value !== next) input.value = next;
  model.value = next;
}
</script>

<template>
  <label :for="id" :class="$style.field">
    <span v-if="label" :class="$style.label">{{ label }}</span>
    <input
      :id="id"
      v-bind="$attrs"
      :class="[$style.input, { [$style.code]: variant === 'code' }]"
      :value="model"
      @input="onInput"
    />
  </label>
</template>

<style module>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--muted);
}

.input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(8, 12, 24, 0.6);
  color: var(--text);
  font: inherit;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.input::placeholder {
  color: rgba(150, 161, 192, 0.6);
}

.input:focus {
  outline: none;
  border-color: rgba(124, 140, 255, 0.7);
  box-shadow: 0 0 0 3px rgba(124, 140, 255, 0.18);
}

.code {
  font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, monospace;
  font-size: 1.15rem;
  letter-spacing: 0.35em;
  text-transform: uppercase;
}
</style>
