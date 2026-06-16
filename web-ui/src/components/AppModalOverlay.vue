<script setup lang="ts">
import { onUnmounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    ariaLabel?: string;
    panelClass?: string;
    closeOnBackdrop?: boolean;
  }>(),
  {
    ariaLabel: "对话框",
    panelClass: "",
    closeOnBackdrop: true,
  },
);

const emit = defineEmits<{
  close: [];
}>();

function onBackdropClick() {
  if (props.closeOnBackdrop) emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="app-modal-fade">
      <div
        v-if="open"
        class="app-modal-overlay"
        @click.self="onBackdropClick"
      >
        <div
          class="app-modal-panel"
          :class="panelClass"
          role="dialog"
          aria-modal="true"
          :aria-label="ariaLabel"
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.48);
  backdrop-filter: blur(2px);
}

.app-modal-panel {
  width: min(720px, 100%);
  max-height: min(88vh, 920px);
  overflow: auto;
  border-radius: 12px;
  background: var(--page-bg, #fff);
  border: 1px solid var(--border-strong, #cbd5e1);
  box-shadow:
    0 24px 48px rgba(15, 23, 42, 0.18),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset;
}

.app-modal-fade-enter-active,
.app-modal-fade-leave-active {
  transition: opacity 0.18s ease;
}

.app-modal-fade-enter-active .app-modal-panel,
.app-modal-fade-leave-active .app-modal-panel {
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
}

.app-modal-fade-enter-from,
.app-modal-fade-leave-to {
  opacity: 0;
}

.app-modal-fade-enter-from .app-modal-panel,
.app-modal-fade-leave-to .app-modal-panel {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
