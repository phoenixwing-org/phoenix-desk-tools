<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BomXrefEdge, XlinkFixCandidateFile } from "../api";
import { applyXlinkFixOverride, fetchXlinkFixCandidates } from "../api";
import { useAppShell } from "../composables/useAppShell";

const props = defineProps<{
  open: boolean;
  hostRepoRel: string;
  edge: BomXrefEdge | null;
}>();

const emit = defineEmits<{
  close: [];
  applied: [];
}>();

const shell = useAppShell();
const partNumber = ref("");
const partVersion = ref("");
const candidates = ref<XlinkFixCandidateFile[]>([]);
const selectedTargetRel = ref("");
const loadingCandidates = ref(false);
const applying = ref(false);
const errorText = ref("");

const oldPath = computed(() => props.edge?.xlink_file_attr?.trim() ?? "");
const currentTarget = computed(() => props.edge?.target_basename?.trim() ?? "—");
const resolveLabel = computed(() => {
  const s = props.edge?.resolve_status ?? "";
  if (s === "missing") return "缺失";
  if (s === "ambiguous") return "歧义";
  if (s === "resolved" || s === "ok" || s === "present") return "已解析";
  return s || "—";
});

const searchBasename = computed(() => {
  const attr = oldPath.value;
  if (attr) return attr.replace(/\\/g, "/").split("/").pop() ?? attr;
  return props.edge?.target_basename?.trim() ?? "";
});

function resolveHostRepoRel(): string {
  const raw = props.hostRepoRel as unknown;
  if (typeof raw === "string") return raw.trim();
  if (raw != null && typeof raw === "object" && "value" in raw) {
    const v = (raw as { value: unknown }).value;
    return typeof v === "string" ? v.trim() : String(v ?? "").trim();
  }
  return String(raw ?? "").trim();
}

function resetForm() {
  candidates.value = [];
  selectedTargetRel.value = "";
  errorText.value = "";
  partNumber.value = "";
  partVersion.value = "";
}

async function loadCandidates() {
  const base = searchBasename.value;
  if (!base) {
    errorText.value = "无 XLink 路径信息";
    return;
  }
  loadingCandidates.value = true;
  errorText.value = "";
  candidates.value = [];
  selectedTargetRel.value = "";
  try {
    const data = await fetchXlinkFixCandidates({
      basename: base,
      part_number: partNumber.value.trim() || undefined,
      part_version: partVersion.value.trim() || undefined,
      exclude_repo_rel: resolveHostRepoRel() || undefined,
    });
    if (data.part_number && !partNumber.value.trim()) partNumber.value = data.part_number;
    candidates.value = data.files ?? [];
  } catch (e) {
    errorText.value = String(e);
    candidates.value = [];
  } finally {
    loadingCandidates.value = false;
  }
}

async function onApply() {
  const host = resolveHostRepoRel();
  const old = oldPath.value;
  const target = selectedTargetRel.value.trim();
  if (!host || !old || !target || loadingCandidates.value || !candidates.value.some((file) => file.repo_rel_path === target)) {
    errorText.value = "请选择目标 FCStd";
    return;
  }
  if (
    !window.confirm(
      `将本文件内的 XLink 写回为所选目标？\n\n原：${old}\n新目标：${target}`,
    )
  ) {
    return;
  }
  applying.value = true;
  errorText.value = "";
  try {
    const result = await applyXlinkFixOverride({
      host_repo_rel: host,
      old_path: old,
      target_repo_rel: target,
    });
    const msg = result.unchanged
      ? "路径未变（已与目标一致）"
      : `已写回 XLink · ${result.new_path}`;
    shell.appendLog(`[文件详情] ${msg}`, { source: "file_detail" });
    shell.setStatus(msg);
    emit("applied");
    emit("close");
  } catch (e) {
    errorText.value = String(e);
    shell.setStatus(String(e));
  } finally {
    applying.value = false;
  }
}

function onClose() {
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") onClose();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetForm();
      void loadCandidates();
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open && edge" class="xlink-replace-overlay" @click.self="onClose">
      <div class="xlink-replace-dialog" role="dialog" aria-modal="true" aria-label="修改 XLink 链接">
        <header class="dialog-head">
          <h2 class="dialog-title">修改 XLink 链接</h2>
          <button type="button" class="btn-close" title="关闭" @click="onClose">关闭</button>
        </header>

        <p class="dialog-lead muted">
          写回<strong>当前文件</strong>内该条引用的 <code>file</code> 属性；默认列出相同零件号的全部版本，请核对后选择目标。
        </p>

        <dl class="summary-dl mono">
          <dt>当前 XLink</dt>
          <dd>{{ oldPath || "—" }}</dd>
          <dt>索引目标</dt>
          <dd>{{ currentTarget }} · {{ resolveLabel }}</dd>
        </dl>

        <div class="search-row">
          <label class="field">
            <span>零件号</span>
            <input v-model="partNumber" class="mono" spellcheck="false" @keydown.enter.prevent="loadCandidates" />
          </label>
          <label class="field">
            <span>版本（可选）</span>
            <input v-model="partVersion" class="mono" placeholder="全部版本" spellcheck="false" @keydown.enter.prevent="loadCandidates" />
          </label>
          <button type="button" class="btn" :disabled="loadingCandidates" @click="loadCandidates">
            {{ loadingCandidates ? "…" : "搜索候选" }}
          </button>
        </div>

        <p v-if="errorText" class="err">{{ errorText }}</p>
        <p v-else-if="loadingCandidates" class="muted">加载候选…</p>
        <p v-else-if="!candidates.length" class="muted">无 present 的 FCStd，请调整零件标识或先在「CAD 索引」更新工作空间。</p>

        <ul v-else class="candidate-list">
          <li v-for="file in candidates" :key="file.id">
            <label class="candidate-item">
              <input
                v-model="selectedTargetRel"
                type="radio"
                name="xlink-replace-target"
                :value="file.repo_rel_path"
              />
              <span class="candidate-name mono">{{ file.filename }}</span>
              <span class="candidate-meta muted">{{ file.part_key }} · {{ file.repo_rel_path }}</span>
            </label>
          </li>
        </ul>

        <footer class="dialog-foot">
          <button type="button" class="btn" :disabled="applying" @click="onClose">取消</button>
          <button
            type="button"
            class="btn primary"
            :disabled="applying || loadingCandidates || !selectedTargetRel"
            @click="onApply"
          >
            {{ applying ? "写回中…" : "写回所选链接" }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.xlink-replace-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.45);
}

.xlink-replace-dialog {
  width: min(560px, 100%);
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.2);
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.dialog-title {
  margin: 0;
  font-size: 1rem;
}

.btn-close {
  border: none;
  background: none;
  font-size: .85rem;
  line-height: 1;
  color: var(--muted);
  cursor: pointer;
}

.dialog-lead {
  margin: 0 0 10px;
  font-size: 0.82rem;
  line-height: 1.45;
}

.summary-dl {
  margin: 0 0 12px;
  font-size: 0.78rem;
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 4px 8px;
}

.summary-dl dt {
  color: var(--muted);
}

.summary-dl dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
  margin-bottom: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.78rem;
}

.field input {
  width: 108px;
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.82rem;
}

.candidate-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
  min-height: 80px;
  max-height: 280px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.candidate-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 0.82rem;
}

.candidate-item:hover {
  background: #f8fafc;
}

.candidate-item + .candidate-item {
  border-top: 1px solid var(--border);
}

.candidate-name {
  font-weight: 600;
}

.candidate-meta {
  flex: 1 1 100%;
  font-size: 0.76rem;
}

.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.btn {
  padding: 6px 14px;
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

.btn:disabled {
  opacity: 0.5;
}

.err {
  color: #b91c1c;
  font-size: 0.82rem;
}

.muted {
  color: var(--muted);
  font-size: 0.82rem;
}

.mono {
  font-family: var(--font-mono);
}
</style>
