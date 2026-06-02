<script setup lang="ts">
import { computed, onUnmounted, watch } from "vue";
import {
  choiceDialogOpen,
  choiceDialogRequest,
  resolveChoice,
  type ChoiceDialogOption,
} from "../composables/choiceDialog";

const open = choiceDialogOpen;
const request = choiceDialogRequest;

const choices = computed(() => request.value?.choices ?? []);

const defaultChoiceId = computed(
  () =>
    request.value?.defaultChoiceId ??
    request.value?.choices.find((c) => c.id === "cancel")?.id ??
    request.value?.choices[0]?.id,
);

function onChoose(opt: ChoiceDialogOption) {
  resolveChoice(opt.id);
}

function onCancel() {
  resolveChoice(null);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    onCancel();
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener("keydown", onKeydown);
  } else {
    window.removeEventListener("keydown", onKeydown);
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open && request" class="choice-overlay" @click.self="onCancel">
      <div class="choice-dialog" role="dialog" aria-modal="true" :aria-label="request.title">
        <h2 class="choice-title">{{ request.title }}</h2>
        <p class="choice-message">{{ request.message }}</p>
        <div class="choice-actions">
          <button
            v-for="opt in choices"
            :key="opt.id"
            type="button"
            class="btn choice-btn"
            :class="{
              primary: opt.variant === 'primary',
              danger: opt.variant === 'danger',
            }"
            :autofocus="opt.id === defaultChoiceId"
            @click="onChoose(opt)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.choice-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.45);
}

.choice-dialog {
  width: min(440px, 100%);
  padding: 20px 22px;
  border-radius: 10px;
  background: var(--page-bg, #fff);
  border: 1px solid var(--border-strong, #cbd5e1);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
}

.choice-title {
  margin: 0 0 10px;
  font-size: 1.05rem;
}

.choice-message {
  margin: 0 0 18px;
  font-size: 0.88rem;
  line-height: 1.55;
  color: var(--text, #0f172a);
  white-space: pre-wrap;
}

.choice-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-btn {
  width: 100%;
  text-align: center;
  padding: 10px 14px;
}

.choice-btn.danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.choice-btn.danger:hover {
  background: #fee2e2;
}
</style>
