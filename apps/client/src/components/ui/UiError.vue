<script setup lang="ts">
defineProps<{ message?: string | null }>();
</script>

<template>
  <p v-if="message" :class="$style.error" role="alert">{{ message }}</p>
</template>

<style module>
.error {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 138, 138, 0.35);
  background: rgba(255, 138, 138, 0.1);
  color: var(--danger);
  font-size: 0.85rem;
}
</style>
