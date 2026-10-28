<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <div class="app">
    <header class="app__header">
      <RouterLink to="/" class="logo" aria-label="На главную">
        <span class="logo__x">X</span><span class="logo__o">O</span>
      </RouterLink>
      <span class="app__tagline">крестики-нолики онлайн</span>
    </header>

    <RouterView />

    <footer class="app__footer">
      Два игрока, одна комната. Без регистрации.
    </footer>
  </div>
</template>
