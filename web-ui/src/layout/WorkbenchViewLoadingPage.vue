<script setup lang="ts">
defineProps<{
  label?: string;
  error?: string;
}>();

defineEmits<{
  retry: [];
}>();
</script>

<template>
  <section class="view-loading-page" :class="{ 'is-error': Boolean(error) }" aria-live="polite">
    <div class="view-loading-card">
      <strong>{{ error ? "View 加载失败" : `正在准备 ${label || "View"}` }}</strong>
      <span v-if="error">{{ error }}</span>
      <span v-else>首次加载完成前，工作台会保留上一个已就绪 View。</span>
      <button v-if="error" type="button" @click="$emit('retry')">重试</button>
    </div>
  </section>
</template>

<style scoped>
.view-loading-page {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  color: var(--phoenix-text-muted);
  background: var(--page-bg);
}

.view-loading-card {
  display: grid;
  gap: 8px;
  max-width: 520px;
  padding: 20px 24px;
  border: 1px solid var(--phoenix-border);
  border-radius: var(--phoenix-radius-md);
  background: var(--phoenix-bg-elevated);
  box-shadow: var(--phoenix-shadow-sm);
}

.view-loading-card strong { color: var(--phoenix-text); }
.view-loading-page.is-error .view-loading-card { border-color: var(--phoenix-warning-border); }
.view-loading-page.is-error strong { color: var(--phoenix-warning-text); }

button {
  justify-self: start;
  padding: 6px 12px;
  border: 1px solid var(--phoenix-border-strong);
  border-radius: var(--phoenix-radius-sm);
  background: var(--btn-bg);
  color: var(--phoenix-text);
}
</style>
