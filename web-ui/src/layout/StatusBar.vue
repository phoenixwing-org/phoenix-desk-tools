<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import ShellPanelToggleBar from "../components/ShellPanelToggleBar.vue";
import { useAppShell } from "../composables/useAppShell";
import { apiUrl, runtimeInfo } from "../utils/runtimeBridge";

const shell = useAppShell();
const apiVersion = ref("");
const apiProtocolVersion = ref<number>();
const apiSource = computed(() => String(runtimeInfo().api_source || "unknown"));
const apiSourceLabel = computed(() => {
  if (apiSource.value === "reused") return "复用 API";
  if (apiSource.value === "managed") return "本机 API";
  return "API";
});
const apiSummary = computed(() => {
  if (!apiVersion.value) return "";
  const protocol = apiProtocolVersion.value == null ? "" : ` / p${apiProtocolVersion.value}`;
  return `${apiSourceLabel.value} v${apiVersion.value}${protocol}`;
});

onMounted(async () => {
  try {
    const response = await fetch(apiUrl("/api/health"));
    if (!response.ok) return;
    const health = await response.json() as { app_version?: unknown; protocol_version?: unknown };
    apiVersion.value = String(health.app_version || runtimeInfo().api_version || "");
    const protocol = Number(health.protocol_version ?? runtimeInfo().protocol_version);
    if (Number.isInteger(protocol)) apiProtocolVersion.value = protocol;
  } catch {
    // The shell already reports API availability; the status suffix is informational.
  }
});

const line = computed(() => {
  const parts: string[] = [];
  const nav = shell.currentNavItem.value;
  parts.push(`【${nav?.label ?? shell.currentPage.value}】`);
  if (shell.statusText.value) parts.push(shell.statusText.value);
  return parts.join("  ·  ") || "phoenix-desk-tools";
});
</script>

<template>
  <footer class="status">
    <span class="status-main">{{ line }}</span>
    <span v-if="apiSummary" class="status-api" :title="String(runtimeInfo().api_origin || '')">{{ apiSummary }}</span>
    <ShellPanelToggleBar />
  </footer>
</template>

<style scoped>
.status {
  height: var(--phoenix-status-height);
  flex-shrink: 0;
  padding: 0 10px 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--phoenix-text-muted);
  background: var(--phoenix-bg-toolbar);
  border-top: 1px solid var(--phoenix-border);
}

.status-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-api {
  flex: 0 0 auto;
  white-space: nowrap;
  color: var(--phoenix-text-muted);
}
</style>
