<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { BomFields, BomPreview, RefHitHost, RefScanPayload } from "../api";
import {
  applyFileRenameRefs,
  executeFileRename,
  fetchFileRenameContext,
  scanFileRenameRefs,
} from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const rel = ref("");
const originalFilename = ref("");
const newFilename = ref("");
const preview = ref<BomPreview | null>(null);
const form = ref<Partial<BomFields>>({});
const baseline = ref<Partial<BomFields>>({});
const renameLogId = ref<number | null>(null);
const renamed = ref(false);
const scan = ref<RefScanPayload | null>(null);
const selectedHosts = ref<Set<string>>(new Set());
const loading = ref(false);
const busy = ref(false);
const pageError = ref("");

const oldBasename = computed(() => originalFilename.value);
const canRename = computed(() => {
  const n = newFilename.value.trim();
  return Boolean(rel.value && n && n !== originalFilename.value);
});

function hasUnsavedDocumentAttrs() {
  const keys = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"] as const;
  for (const k of keys) {
    const cur = String(form.value[k] ?? "").trim();
    const base = String(baseline.value[k] ?? "").trim();
    if (cur !== base) return true;
  }
  return false;
}

function toggleHost(hostRel: string, checked: boolean) {
  const next = new Set(selectedHosts.value);
  if (checked) next.add(hostRel);
  else next.delete(hostRel);
  selectedHosts.value = next;
}

function toggleAll(checked: boolean) {
  if (!scan.value) return;
  if (checked) {
    selectedHosts.value = new Set(
      scan.value.hosts.filter((h) => h.hits.some((x) => x.status !== "applied")).map((h) => h.host_repo_rel_path),
    );
  } else {
    selectedHosts.value = new Set();
  }
}

function hostPending(h: RefHitHost) {
  return h.hits.some((x) => x.status !== "applied");
}

async function loadFromPending() {
  const pending = shell.pendingFileRename.value;
  if (!pending) return;
  shell.pendingFileRename.value = null;
  rel.value = pending.rel;
  form.value = { ...pending.form };
  baseline.value = { ...pending.baseline };
  newFilename.value = String(pending.form.filename ?? "").trim();
  loading.value = true;
  pageError.value = "";
  try {
    const data = await fetchFileRenameContext(pending.rel);
    preview.value = data.preview;
    originalFilename.value = data.preview.fields.filename || pending.rel.split("/").pop() || "";
    if (!newFilename.value) {
      newFilename.value = originalFilename.value;
    }
  } catch (e) {
    pageError.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function onRename() {
  if (!rel.value || !canRename.value) return;
  let writeAttrsFirst = false;
  if (hasUnsavedDocumentAttrs()) {
    if (
      !window.confirm(
        `有尚未写入文件的属性。\n\n是否先写入 Document.xml，再重命名？\n\n${originalFilename.value}\n    ↓\n${newFilename.value.trim()}\n\n请确认 FreeCAD 等已关闭占用。`,
      )
    ) {
      shell.setStatus("改名已取消");
      return;
    }
    writeAttrsFirst = true;
  } else if (
    !window.confirm(
      `将重命名磁盘文件：\n\n${originalFilename.value}\n    ↓\n${newFilename.value.trim()}\n\n请确认 FreeCAD 等已关闭占用。`,
    )
  ) {
    return;
  }
  busy.value = true;
  pageError.value = "";
  try {
    const payload = {
      ...form.value,
      filename: newFilename.value.trim(),
    };
    const data = await executeFileRename(rel.value, payload, baseline.value, { writeAttrsFirst });
    renamed.value = true;
    renameLogId.value = data.rename_log_id ?? data.rename_log?.id ?? null;
    rel.value = data.rel_path;
    originalFilename.value = data.filename;
    form.value = { ...form.value, filename: data.filename };
    baseline.value = { ...form.value };
    scan.value = null;
    selectedHosts.value = new Set();
    shell.requestTreeRescan(data.rel_path);
    const parts = [
      data.attrs_saved ? "已写入属性" : null,
      `已重命名为 ${data.filename}`,
      data.map_updated ? "已更新索引库" : null,
    ].filter(Boolean);
    shell.setStatus(parts.join(" · "));
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onScanRefs() {
  busy.value = true;
  pageError.value = "";
  try {
    let data: RefScanPayload;
    if (renameLogId.value != null) {
      data = await scanFileRenameRefs({ rename_log_id: renameLogId.value, persist: true });
    } else {
      const oldName = originalFilename.value.trim();
      const newName = newFilename.value.trim();
      if (!oldName || !newName || oldName === newName) {
        pageError.value = "请先填写不同的目标文件名，或完成改名后再分析";
        return;
      }
      data = await scanFileRenameRefs({
        old_basename: oldName,
        new_basename: newName,
        persist: false,
      });
    }
    scan.value = data;
    selectedHosts.value = new Set(data.hosts.filter(hostPending).map((h) => h.host_repo_rel_path));
    shell.setStatus(`引用分析：${data.host_count} 个宿主 · ${data.hit_count} 处 XLink`);
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onApplyRefs() {
  if (renameLogId.value == null) {
    pageError.value = "请先执行改名，再修正引用（预览扫描无法写回）";
    return;
  }
  const hosts = [...selectedHosts.value];
  if (!hosts.length) {
    pageError.value = "请勾选至少一个宿主文件";
    return;
  }
  if (
    !window.confirm(
      `将修正 ${hosts.length} 个宿主文件内的 XLink（仅替换 file 属性中的旧 basename）。\n\n请确认 FreeCAD 等已关闭占用。`,
    )
  ) {
    return;
  }
  busy.value = true;
  pageError.value = "";
  try {
    const data = await applyFileRenameRefs(renameLogId.value, hosts);
    scan.value = data.scan;
    selectedHosts.value = new Set(data.scan.hosts.filter(hostPending).map((h) => h.host_repo_rel_path));
    if (data.failed.length) {
      shell.appendLog(
        data.failed.map((f) => `${f.host_repo_rel_path}: ${f.error}`).join("\n"),
        { source: "file_rename" },
      );
    }
    shell.setStatus(
      `已修正 ${data.applied_hosts.length} 个宿主 · ${data.xlink_patches} 处 XLink` +
        (data.failed.length ? ` · ${data.failed.length} 失败` : ""),
    );
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void loadFromPending();
});

watch(
  () => shell.pendingFileRename.value,
  (pending) => {
    if (!pending) return;
    void loadFromPending();
  },
);
</script>

<template>
  <div class="page rename-page">
    <header class="page-head">
      <h1 class="page-title">文件改名</h1>
      <p class="page-desc">
        重命名 FCStd 并分析/修正其他文件中仍引用旧文件名的 XLink（仅替换 basename，不改目录层级）。
      </p>
    </header>

    <div v-if="pageError" class="banner err">{{ pageError }}</div>

    <div v-if="!rel && !loading" class="empty">
      请从「属性回写」页填写目标文件名后点击「改名」，或在此页通过侧栏选择文件（待接）。
    </div>
    <div v-else-if="loading" class="empty">载入中…</div>
    <template v-else>
      <section class="file-block">
        <h2 class="mono file-name">{{ preview?.fields.filename || rel.split("/").pop() }}</h2>
        <p v-if="preview" class="meta">{{ preview.abs_path_display }}</p>
        <p v-if="renamed && renameLogId" class="meta ok">已改名 · 记录 #{{ renameLogId }}</p>
      </section>

      <section class="rename-row">
        <label>
          <span>当前文件名</span>
          <input :value="originalFilename" readonly class="readonly" />
        </label>
        <label>
          <span>目标文件名</span>
          <input v-model="newFilename" :readonly="renamed" spellcheck="false" />
        </label>
      </section>

      <section class="toolbar">
        <button type="button" class="btn primary" :disabled="busy || renamed || !canRename" @click="onRename">
          {{ busy ? "…" : "执行改名" }}
        </button>
        <button type="button" class="btn" :disabled="busy" @click="onScanRefs">改名分析</button>
        <button
          type="button"
          class="btn accent"
          :disabled="busy || !renameLogId || selectedHosts.size === 0"
          @click="onApplyRefs"
        >
          修正选中引用
        </button>
      </section>

      <section v-if="scan" class="scan-panel">
        <div class="scan-head">
          <h3 class="scan-title">改名分析</h3>
          <span class="scan-stats">
            宿主 <strong>{{ scan.host_count }}</strong> · XLink <strong>{{ scan.hit_count }}</strong>
          </span>
          <label v-if="scan.hosts.length" class="chk-all">
            <input
              type="checkbox"
              :checked="selectedHosts.size > 0 && selectedHosts.size === scan.hosts.filter(hostPending).length"
              @change="toggleAll(($event.target as HTMLInputElement).checked)"
            />
            全选待修正
          </label>
        </div>

        <p v-if="!scan.host_count" class="muted">未发现仍引用旧文件名的 XLink。</p>

        <ul v-else class="host-list">
          <li v-for="host in scan.hosts" :key="host.host_repo_rel_path" class="host-item">
            <label class="host-row" :class="{ applied: !hostPending(host) }">
              <input
                type="checkbox"
                :disabled="!hostPending(host) || !renameLogId"
                :checked="selectedHosts.has(host.host_repo_rel_path)"
                @change="toggleHost(host.host_repo_rel_path, ($event.target as HTMLInputElement).checked)"
              />
              <span class="host-name mono">{{ host.host_filename }}</span>
              <span class="host-meta">{{ host.hit_count }} 处</span>
              <span v-if="!hostPending(host)" class="tag ok">已修正</span>
            </label>
            <ul class="hit-list">
              <li v-for="(hit, idx) in host.hits" :key="idx" class="mono hit-line">
                {{ hit.matched_text }} → {{ hit.proposed_text }}
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <section class="help-panel">
        <h3 class="help-title">说明</h3>
        <ul class="help-list">
          <li>与「链接路径修正」不同：此处按<strong>已知旧名 → 新名</strong>替换 XLink 的 <code>file</code> 末尾 basename。</li>
          <li>改名前可「分析引用」预览；<strong>修正写回</strong>须先「执行改名」。</li>
          <li>扫描范围与工作空间 CAD 索引的扫描根一致；被改名的文件本身不会作为宿主。</li>
          <li>勾选宿主后点「修正选中引用」写回各 FCStd 内的 Document.xml。</li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.rename-page {
  padding: 20px 24px 24px;
  max-width: 920px;
  height: 100%;
  overflow: auto;
}

.page-head {
  margin-bottom: 12px;
}

.page-title {
  margin: 0 0 4px;
  font-size: 1.15rem;
}

.page-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
  line-height: 1.55;
}

.empty {
  padding: 32px 0;
  color: var(--muted);
}

.banner {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  margin-bottom: 10px;
}

.banner.err {
  background: #fef2f2;
  color: #b91c1c;
}

.file-block {
  margin-bottom: 12px;
}

.file-name {
  margin: 0 0 4px;
  font-size: 1rem;
}

.meta {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
}

.meta.ok {
  color: #047857;
  margin-top: 4px;
}

.rename-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.rename-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.82rem;
}

.rename-row input {
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.rename-row input.readonly {
  background: #f3f4f6;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn.accent {
  background: #047857;
  color: #fff;
  border-color: #047857;
}

.btn:disabled {
  opacity: 0.5;
}

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
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 0.85rem;
}

.scan-title {
  margin: 0;
  font-size: 0.95rem;
}

.scan-stats {
  color: var(--muted);
  font-size: 0.82rem;
}

.chk-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
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

.help-panel {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.help-title {
  margin: 0 0 8px;
  font-size: 0.88rem;
}

.help-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.55;
}

.help-list li + li {
  margin-top: 6px;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
