<script setup lang="ts">
import type { RefHitHost, RefScanPayload } from "../api";

const props = defineProps<{
  scan: RefScanPayload | null;
  selectedHosts: Set<string>;
  busy?: boolean;
  canApply?: boolean;
  showExport?: boolean;
}>();

const emit = defineEmits<{
  toggleHost: [hostRel: string, checked: boolean];
  toggleAll: [checked: boolean];
  apply: [];
  exportReport: [];
}>();

function hostPending(h: RefHitHost) {
  return h.hits.length > 0 && h.hits.some((x) => x.status !== "applied");
}

function hostRelationLabel(h: RefHitHost) {
  if (h.usage_kind === "indirect" || (h.depth ?? 0) > 0) {
    const depth = h.depth ?? 0;
    return depth > 0 ? `间接 · 层级 ${depth}` : "间接";
  }
  return "直接 XLink";
}

const pendingHosts = () => (props.scan?.hosts ?? []).filter(hostPending);

const allPendingSelected = () => {
  const pending = pendingHosts();
  return pending.length > 0 && pending.every((h) => props.selectedHosts.has(h.host_repo_rel_path));
};
</script>

<template>
  <section v-if="scan" class="scan-panel">
    <div class="scan-head">
      <div>
        <h3 class="scan-title">改名分析</h3>
        <p v-if="scan.old_basename && scan.new_basename" class="scan-names mono">
          <template v-if="scan.old_basename.toLowerCase() === scan.new_basename.toLowerCase()">
            当前引用：{{ scan.old_basename }}
          </template>
          <template v-else>
            {{ scan.old_basename }} → {{ scan.new_basename }}
          </template>
        </p>
      </div>
      <span class="scan-stats">
        宿主 <strong>{{ scan.host_count }}</strong>
        <template v-if="scan.transitive !== false && scan.direct_host_count != null && scan.direct_host_count < scan.host_count">
          · 直接 <strong>{{ scan.direct_host_count }}</strong>
          · 间接 <strong>{{ scan.host_count - scan.direct_host_count }}</strong>
        </template>
        · XLink <strong>{{ scan.hit_count }}</strong>
      </span>
    </div>

    <div class="scan-actions">
      <label v-if="scan.hosts.length" class="chk-all">
        <input type="checkbox" :checked="allPendingSelected()" @change="emit('toggleAll', ($event.target as HTMLInputElement).checked)" />
        全选待修正
      </label>
      <button
        type="button"
        class="btn accent"
        :disabled="busy || !canApply || selectedHosts.size === 0"
        @click="emit('apply')"
      >
        修正选中引用
      </button>
      <button v-if="showExport" type="button" class="btn" :disabled="busy || !scan.host_count" @click="emit('exportReport')">
        导出报告
      </button>
    </div>

    <p v-if="!scan.host_count" class="muted">未发现仍引用旧文件名的 XLink。</p>

    <ul v-else class="host-list">
      <li v-for="host in scan.hosts" :key="host.host_repo_rel_path" class="host-item">
        <label class="host-row" :class="{ applied: !hostPending(host) }">
          <input
            type="checkbox"
            :disabled="!hostPending(host) || !canApply"
            :checked="selectedHosts.has(host.host_repo_rel_path)"
            @change="emit('toggleHost', host.host_repo_rel_path, ($event.target as HTMLInputElement).checked)"
          />
          <span class="host-name mono">{{ host.host_filename }}</span>
          <span v-if="host.usage_kind === 'indirect' || (host.depth ?? 0) > 0" class="tag indirect">
            {{ hostRelationLabel(host) }}
          </span>
          <span class="host-meta">{{ host.hit_count }} 处</span>
          <span v-if="!hostPending(host)" class="tag ok">已修正</span>
        </label>
        <ul class="hit-list">
          <li v-if="host.via_chain?.length" class="mono via-line muted">
            经子装配：{{ host.via_chain.join(" → ") }}
          </li>
          <li v-if="!host.hit_count && (host.usage_kind === 'indirect' || (host.depth ?? 0) > 0)" class="muted hit-line">
            无直接 XLink（总装配经子装配间接引用，改名时无需修正此文件）
          </li>
          <li v-for="(hit, idx) in host.hits" :key="idx" class="mono hit-line">
            {{ hit.matched_text }} → {{ hit.proposed_text }}
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.scan-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 16px;
  background: #fff;
}

.scan-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.scan-title {
  margin: 0 0 4px;
  font-size: 0.95rem;
}

.scan-names {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
}

.scan-stats {
  color: var(--muted);
  font-size: 0.82rem;
}

.scan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.chk-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
}

.btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
}

.btn.accent {
  background: #047857;
  color: #fff;
  border-color: #047857;
}

.btn:disabled {
  opacity: 0.5;
}

.host-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.host-item + .host-item {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.host-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  cursor: pointer;
}

.host-row.applied {
  opacity: 0.65;
}

.host-name {
  flex: 1;
}

.host-meta {
  color: var(--muted);
  font-size: 0.78rem;
}

.tag.ok {
  font-size: 0.72rem;
  color: #047857;
}

.tag.indirect {
  font-size: 0.72rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: #dbeafe;
  color: #1d4ed8;
}

.via-line {
  margin-bottom: 4px;
}

.hit-list {
  margin: 6px 0 0 24px;
  padding: 0;
  list-style: none;
  font-size: 0.78rem;
  color: var(--muted);
}

.hit-line + .hit-line {
  margin-top: 2px;
}

.muted {
  color: var(--muted);
  font-size: 0.85rem;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
