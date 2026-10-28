<template>
  <section :class="$style.card">
    <slot />
  </section>
</template>

<style module>
.card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
  box-shadow: var(--shadow);
  backdrop-filter: blur(6px);
}

@media (max-width: 520px) {
  .card {
    padding: 16px;
  }
}
</style>
