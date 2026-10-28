<script setup lang="ts">
import { CODE_ALPHABET, CODE_LENGTH, NAME_MAX_LENGTH } from '@ttt/shared';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiError from '@/components/ui/UiError.vue';
import UiInput from '@/components/ui/UiInput.vue';
import { loadName, saveName } from '@/lib/session';
import { useGameStore } from '@/stores/game';

const router = useRouter();
const store = useGameStore();

const name = ref(loadName());
const code = ref('');
const busy = ref<'create' | 'join' | null>(null);

function normalizeCode(value: string): string {
  return value
    .toUpperCase()
    .split('')
    .filter((char) => CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, CODE_LENGTH);
}

function ensureName(): string | null {
  const clean = name.value.trim();
  if (!clean) {
    store.setError('Введите имя');
    return null;
  }
  saveName(clean);
  return clean;
}

async function create(): Promise<void> {
  const clean = ensureName();
  if (!clean) return;

  busy.value = 'create';
  try {
    const created = await store.create(clean);
    await router.push({ name: 'game', params: { code: created } });
  } catch {
    // текст ошибки уже в store.error
  } finally {
    busy.value = null;
  }
}

async function join(): Promise<void> {
  const clean = ensureName();
  if (!clean) return;

  if (code.value.length !== CODE_LENGTH) {
    store.setError(`Код комнаты состоит из ${CODE_LENGTH} символов`);
    return;
  }

  busy.value = 'join';
  try {
    await store.join(code.value, clean);
    await router.push({ name: 'game', params: { code: code.value } });
  } catch {
    // текст ошибки уже в store.error
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <main class="page">
    <section class="hero">
      <h1 class="hero__title">
        Крестики-нолики<br />
        <span class="hero__accent">онлайн на двоих</span>
      </h1>
      <p class="muted">
        Создайте комнату и отправьте ссылку другу. Партия начнётся сразу, как только он подключится.
      </p>
    </section>

    <UiCard>
      <form class="create" @submit.prevent="create">
        <UiInput
          v-model="name"
          label="Ваше имя"
          :maxlength="NAME_MAX_LENGTH"
          placeholder="Например, Аня"
          autocomplete="nickname"
        />

        <UiButton type="submit" :disabled="busy !== null">
          {{ busy === 'create' ? 'Создаём…' : 'Создать игру' }}
        </UiButton>
      </form>

      <div class="divider"><span>или</span></div>

      <form class="join" @submit.prevent="join">
        <UiInput
          v-model="code"
          label="Код комнаты"
          variant="code"
          :normalize="normalizeCode"
          placeholder="ABC234"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
        />
        <UiButton variant="secondary" type="submit" :disabled="busy !== null">
          {{ busy === 'join' ? 'Входим…' : 'Присоединиться' }}
        </UiButton>
      </form>

      <UiError :message="store.error" />
    </UiCard>

    <ul class="hints">
      <li>Две вкладки браузера тоже подходят, чтобы попробовать.</li>
      <li>Короткий обрыв связи не прерывает партию — можно вернуться.</li>
    </ul>
  </main>
</template>
