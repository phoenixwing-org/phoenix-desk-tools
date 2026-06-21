<script setup lang="ts">
import type { RefHitHost, RefScanPayload } from "../api";

const props = withDefaults(
  defineProps<{
    scan: RefScanPayload | null;
    selectedHosts: Set<string>;
    busy?: boolean;
    canApply?: boolean;
    canApplyIncomingLabels?: boolean;
    canApplyHostAllLabels?: boolean;
    showCurrentFileHostAll?: boolean;
    showExport?: boolean;
    /** off=不展示；incoming-only=仅「勾选装配内对本文件」；full=三项高级（改名与引用页） */
    labelSyncUi?: "off" | "incoming-only" | "full";
    /** incoming-only 时展示的目标短名（如刚改名的文件） */
    targetLabel?: string;
  }>(),
  { labelSyncUi: "full" },
);

const emit = defineEmits<{
  toggleHost: [hostRel: string, checked: boolean];
  toggleAll: [checked: boolean];
  apply: [];
  applyIncomingLabels: [];
  applyHostAllLabels: [];
  applyCurrentFileHostAll: [];
  exportReport: [];
}>();

function hitNeedsFix(hit: { status: string; proposed_text: string; matched_text: string }) {
  if (hit.status === "applied" || hit.status === "ok") return false;
  return hit.proposed_text !== hit.matched_text;
}

function chainPendingHits(host: RefHitHost, all: RefHitHost[]) {
  const chain = new Set((host.via_chain ?? []).map((p) => p.replace(/\\/g, "/")));
  const rows: Array<{
    hostPath: string;
    hostName: string;
    matched_text: string;
    proposed_text: string;
  }> = [];
  for (const h of all) {
    const hp = h.host_repo_rel_path.replace(/\\/g, "/");
    if (!chain.has(hp)) continue;
    for (const hit of h.hits) {
      if (hitNeedsFix(hit)) {
        rows.push({
          hostPath: h.host_repo_rel_path,
          hostName: h.host_filename,
          matched_text: hit.matched_text,
          proposed_text: hit.proposed_text,
        });
      }
    }
  }
  return rows;
}

function hostIncomingLabelSelectable(h: RefHitHost) {
  if (h.hits.length > 0) return true;
  const all = props.scan?.hosts ?? [];
  return chainPendingHits(h, all).length > 0;
}

function hostCheckboxEnabled(h: RefHitHost) {
  if (props.busy) return false;
  if (props.canApplyHostAllLabels) return true;
  if (props.canApplyIncomingLabels && hostIncomingLabelSelectable(h)) return true;
  if (props.canApply && hostPending(h)) return true;
  return false;
}

function hostPending(h: RefHitHost) {
  if (h.hits.some(hitNeedsFix)) return true;
  const all = props.scan?.hosts ?? [];
  return chainPendingHits(h, all).length > 0;
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
        <p class="scan-names mono">
          <template v-if="scan.old_basename && scan.new_basename && scan.old_basename.toLowerCase() !== scan.new_basename.toLowerCase()">
            {{ scan.old_basename }} → {{ scan.new_basename }}（含相对路径修正）
          </template>
          <template v-else-if="scan.old_basename">
            按文件名 {{ scan.old_basename }} 检查 XLink（目录不一致也会列出）
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
        <template v-if="scan.pending_hit_count != null">
          · 待修正 <strong>{{ scan.pending_hit_count }}</strong>
        </template>
      </span>
    </div>

    <div class="scan-step step-xlink">
      <div class="step-head">
        <span class="step-badge">第一步</span>
        <span class="step-label">修正 XLink 路径（<code>file</code> 属性）</span>
      </div>
      <div class="scan-actions">
        <el-checkbox
          v-if="scan.hosts.length"
          :model-value="allPendingSelected()"
          @change="emit('toggleAll', Boolean($event))"
        >
          全选待修正
        </el-checkbox>
        <el-button
          type="success"
          size="small"
          :disabled="busy || !canApply || selectedHosts.size === 0"
          @click="emit('apply')"
        >
          修正选中引用
        </el-button>
        <el-button
          v-if="showExport"
          size="small"
          :disabled="busy || !scan.host_count"
          @click="emit('exportReport')"
        >
          导出报告
        </el-button>
      </div>
    </div>

    <div v-if="labelSyncUi !== 'off'" class="scan-step step-labels">
      <div class="step-head">
        <span class="step-badge step-badge-secondary">可选</span>
        <span class="step-label">同步装配树显示名（Label）</span>
      </div>
      <p v-if="labelSyncUi === 'incoming-only'" class="step-hint muted">
        在<strong>已勾选</strong>的装配/图纸里，只改「引用
        <template v-if="targetLabel || scan?.new_basename">
          <span class="mono">{{ targetLabel || scan?.new_basename }}</span>
        </template>
        <template v-else>本目标文件</template>
        」那一项的树节点名（不改 XLink 路径）。日常维护请用<strong>文件详情 → 引用</strong>。
      </p>
      <template v-else>
        <ul class="label-legend muted">
          <li>
            <strong>勾选装配内对本文件</strong> — 只改引用当前目标文件的那几条显示名（改名后常用）。
          </li>
          <li v-if="showCurrentFileHostAll">
            <strong>当前文件内全部</strong> — 当前打开的是装配/图纸时，改其内部<strong>所有</strong>外链显示名。
          </li>
          <li>
            <strong>勾选装配内全部</strong> — 在每个勾选的装配里，改<strong>所有</strong>外链显示名（不限于本文件）。
          </li>
        </ul>
      </template>
      <div class="scan-actions">
        <el-button
          type="success"
          size="small"
          plain
          :disabled="busy || !canApplyIncomingLabels || selectedHosts.size === 0"
          title="仅同步勾选宿主内指向本目标文件的引用实例 Label"
          @click="emit('applyIncomingLabels')"
        >
          {{
            labelSyncUi === "incoming-only"
              ? "同步勾选装配内对本文件的显示名"
              : "勾选装配内对本文件"
          }}
        </el-button>
        <template v-if="labelSyncUi === 'full'">
          <el-button
            v-if="showCurrentFileHostAll"
            size="small"
            :disabled="busy || !canApplyHostAllLabels"
            title="当前打开文件作为装配/图纸宿主，同步其内部全部外部引用 Label"
            @click="emit('applyCurrentFileHostAll')"
          >
            当前文件内全部
          </el-button>
          <el-button
            size="small"
            :disabled="busy || !canApplyHostAllLabels || selectedHosts.size === 0"
            title="在每个勾选的装配/图纸内，同步其全部外部引用 Label"
            @click="emit('applyHostAllLabels')"
          >
            勾选装配内全部
          </el-button>
        </template>
      </div>
    </div>

    <p v-if="!scan.host_count" class="muted">未发现仍引用旧文件名的 XLink。</p>

    <ul v-else class="host-list">
      <li v-for="host in scan.hosts" :key="host.host_repo_rel_path" class="host-item">
        <label class="host-row" :class="{ applied: !hostPending(host) }">
          <el-checkbox
            :disabled="!hostCheckboxEnabled(host)"
            :model-value="selectedHosts.has(host.host_repo_rel_path)"
            @change="emit('toggleHost', host.host_repo_rel_path, Boolean($event))"
          />
          <span class="host-name mono">{{ host.host_filename }}</span>
          <el-tag v-if="host.usage_kind === 'indirect' || (host.depth ?? 0) > 0" size="small" type="info" effect="plain">
            {{ hostRelationLabel(host) }}
          </el-tag>
          <span class="host-meta">
            {{
              host.hit_count ||
              chainPendingHits(host, scan.hosts).length ||
              0
            }}
            处
          </span>
          <span v-if="hostPending(host)" class="tag warn">
            {{ (host.depth ?? 0) > 0 && !host.hits.some(hitNeedsFix) ? "间接 · 待修正" : "待修正" }}
          </span>
          <el-tag v-else-if="host.hit_count && host.hits.every((x) => x.status === 'ok')" size="small" type="success" effect="plain">
            路径正确
          </el-tag>
          <el-tag v-else-if="!hostPending(host)" size="small" type="success" effect="plain">已修正</el-tag>
        </label>
        <ul class="hit-list">
          <li v-if="host.via_chain?.length" class="mono via-line muted">
            经子装配：{{ host.via_chain.join(" → ") }}
          </li>
          <li
            v-for="(rollup, idx) in chainPendingHits(host, scan.hosts)"
            :key="`chain-${idx}`"
            class="mono hit-line chain-hit"
          >
            {{ rollup.hostName }}：{{ rollup.matched_text }} → {{ rollup.proposed_text }}
          </li>
          <li
            v-if="(host.depth ?? 0) > 0 && chainPendingHits(host, scan.hosts).length"
            class="muted hit-line chain-note"
          >
            勾选此间接宿主将写回上列子装配中的 XLink（FreeCAD 每条引用均含相对路径，需一并修正）
          </li>
          <li v-for="(hit, idx) in host.hits" :key="idx" class="mono hit-line">
            {{ hit.matched_text }} → {{ hit.proposed_text }}
            <el-tag v-if="hit.status === 'ok'" size="small" type="success" effect="plain">路径正确</el-tag>
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

.scan-step {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #fafafa;
}

.scan-step.step-labels {
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.step-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.step-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: #dbeafe;
  color: #1d4ed8;
}

.step-badge-secondary {
  background: #dcfce7;
  color: #047857;
}

.step-label {
  font-size: 0.84rem;
  color: var(--text);
}

.step-hint {
  margin: 0 0 8px;
  font-size: 0.78rem;
  line-height: 1.45;
}

.label-legend {
  margin: 0 0 10px;
  padding-left: 1.2em;
  font-size: 0.78rem;
  line-height: 1.5;
}

.label-legend li + li {
  margin-top: 4px;
}

.scan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
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

.tag.warn {
  font-size: 0.72rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: #fef3c7;
  color: #b45309;
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

.via-line {
  margin-bottom: 4px;
}

.chain-hit {
  color: #1d4ed8;
}

.chain-note {
  font-size: 0.78rem;
  line-height: 1.45;
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
