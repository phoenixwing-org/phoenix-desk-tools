<script setup lang="ts">
defineProps<{
  message: string;
  actionLabel?: string;
}>();

const emit = defineEmits<{
  action: [];
}>();
</script>

<template>
  <div class="onboarding-banner" role="status">
    <span class="banner-text">{{ message }}</span>
    <button
      v-if="actionLabel"
      type="button"
      class="banner-btn"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </button>
  </div>
</template>

<style scoped>
.onboarding-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  margin: 0 0 14px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  font-size: 0.86rem;
  color: #92400e;
}

.banner-btn {
  padding: 4px 12px;
  border: 1px solid #fbbf24;
  border-radius: 6px;
  background: #fff;
  color: #b45309;
  font-size: 0.82rem;
}
</style>
