<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  fetchTestFixtures,
  pickWorkspaceDirectory,
  syncTestFixtures,
  updateTestFixturesPrefs,
  type TestFixtureItem,
  type TestFixturesPayload,
} from "../api";
import { useAppShell } from "../composables/useAppShell";
import { useTestFixturesPropertySheet } from "../composables/useTestFixturesPropertySheet";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const loading = ref(false);
const syncing = ref(false);
const busyName = ref<string | null>(null);
const pickingRoot = ref(false);
const payload = ref<TestFixturesPayload | null>(null);

const checkoutRootInput = ref("");
const enabledSet = ref<Set<string>>(new Set());

const items = computed(() => payload.value?.items ?? []);

onMounted(() => void reload());

async function reload() {
  loading.value = true;
  try {
    payload.value = await fetchTestFixtures();
    checkoutRootInput.value = payload.value.checkout_root || payload.value.default_checkout_root;
    enabledSet.value = new Set(payload.value.enabled ?? []);
  } catch (e) {
    ElMessage.error(String(e));
  } finally {
    loading.value = false;
  }
}

function isEnabled(name: string) {
  return enabledSet.value.has(name);
}

function toggleEnabledLocal(name: string, on: boolean) {
  const next = new Set(enabledSet.value);
  if (on) next.add(name);
  else next.delete(name);
  enabledSet.value = next;
  return next;
}

async function applySync(triggerName?: string, opts?: { silent?: boolean }) {
  if (!enabledSet.value.size) {
    ElMessage.warning("请至少勾选一个测试工程");
    return false;
  }
  syncing.value = true;
  busyName.value = triggerName ?? null;
  if (!opts?.silent) {
    shell.appendLog("[检出测试工程] 检出（git clone）…", { source: "test_fixtures", open: true });
  }
  try {
    const data = await syncTestFixtures({
      checkout_root: checkoutRootInput.value.trim(),
      enabled: [...enabledSet.value],
      names: triggerName ? [triggerName] : undefined,
    });
    payload.value = data;
    checkoutRootInput.value = data.checkout_root || data.default_checkout_root;
    enabledSet.value = new Set(data.enabled ?? []);
    for (const r of data.sync_results ?? []) {
      shell.appendLog(`  ${r.name}: ${r.status} — ${r.detail}`, { source: "test_fixtures" });
    }
    const failed = (data.sync_results ?? []).filter((r) => r.status === "error" || r.status === "skipped");
    if (failed.length) {
      ElMessage.warning("部分工程未完成，请查看运行日志");
      return false;
    }
    if (!opts?.silent) {
      ElMessage.success(triggerName ? `${triggerName} 已完成` : "检出完成");
    }
    return true;
  } catch (e) {
    const msg = String(e);
    shell.appendLog(msg, { source: "test_fixtures" });
    ElMessage.error(msg);
    return false;
  } finally {
    syncing.value = false;
    busyName.value = null;
  }
}

async function onToggleEnabled(name: string, on: boolean) {
  if (syncing.value) return;
  const prev = new Set(enabledSet.value);
  const next = toggleEnabledLocal(name, on);
  try {
    payload.value = await updateTestFixturesPrefs({
      checkout_root: checkoutRootInput.value.trim(),
      enabled: [...next],
    });
    enabledSet.value = new Set(payload.value.enabled ?? [...next]);
  } catch (e) {
    enabledSet.value = prev;
    ElMessage.error(String(e));
  }
}

async function useDefaultCheckoutRoot() {
  const d = payload.value?.default_checkout_root ?? "";
  if (d) checkoutRootInput.value = d;
}

async function browseCheckoutRoot() {
  if (pickingRoot.value) return;
  pickingRoot.value = true;
  try {
    const data = await pickWorkspaceDirectory(checkoutRootInput.value.trim());
    if (!data.cancelled && data.path?.trim()) {
      checkoutRootInput.value = data.path.trim();
    }
  } catch (e) {
    ElMessage.error(String(e));
  } finally {
    pickingRoot.value = false;
  }
}

async function syncFixtures() {
  await applySync();
}

function statusTagType(item: TestFixtureItem) {
  if (item.checkout_exists) return "success";
  return "info";
}

function checkoutLabel(item: TestFixtureItem) {
  return item.checkout_exists ? "已检出" : "未检出";
}

function checkoutActionLabel(item: TestFixtureItem) {
  return item.checkout_exists ? "已检出" : "检出";
}

function checkoutPath(name: string) {
  const root = checkoutRootInput.value.trim() || payload.value?.default_checkout_root || "…";
  return `${root}/${name}`;
}

function isCheckedOut(row: TestFixtureItem) {
  return row.checkout_exists;
}

function needsSetup(row: TestFixtureItem) {
  return isEnabled(row.name) && !isCheckedOut(row);
}

const checkedOutCount = computed(() => items.value.filter((i) => isCheckedOut(i)).length);
const enabledCount = computed(() => enabledSet.value.size);

const primaryActionLabel = computed(() => {
  if (!enabledCount.value) return "检出任选";
  return "检出已勾选";
});

const checkoutRootDisplay = computed(
  () => checkoutRootInput.value.trim() || payload.value?.default_checkout_root || "",
);

const checkoutRootHint = computed(() => {
  const def = payload.value?.default_checkout_root ?? "—";
  const root = checkoutRootInput.value.trim() || def;
  return `默认目录：${def}；项目将检出到 ${root} 下各自的同名子目录。`;
});

useTestFixturesPropertySheet("test_fixtures", {
  checkoutRoot: checkoutRootDisplay,
  enabledCount,
  totalCount: computed(() => items.value.length),
  checkedOutCount,
  loading,
  syncing,
});

usePagePrimaryContribution("test_fixtures", props.workbenchTabId, {
  summary: computed(() => `已启用 ${enabledCount.value} / ${items.value.length} · 已检出 ${checkedOutCount.value}`),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "checkout",
      title: "检出目录",
      controls: [
        {
          id: "root",
          kind: "text",
          label: "本机检出根",
          modelValue: checkoutRootInput,
          placeholder: "默认使用桌面应用数据目录",
          mono: true,
          disabled: syncing,
          onUpdate: (value) => { checkoutRootInput.value = value; },
        },
        { id: "enabled", kind: "readonly", label: "已启用", value: enabledCount },
        { id: "checked-out", kind: "readonly", label: "已检出", value: checkedOutCount },
      ],
      actions: [
        { id: "default", label: "使用默认目录", disabled: syncing, run: useDefaultCheckoutRoot },
        { id: "browse", label: "浏览…", loading: pickingRoot, disabled: syncing, run: browseCheckoutRoot },
        { id: "refresh", label: "刷新状态", loading, disabled: syncing, run: reload },
      ],
    },
    {
      id: "projects",
      title: "测试工程",
      description: "勾选需要引用的系统内置工程，再执行检出。",
      controls: items.value.map((item) => ({
        id: `fixture-${item.name}`,
        kind: "boolean" as const,
        label: item.name,
        description: item.checkout_exists ? "已检出" : item.description,
        modelValue: computed(() => isEnabled(item.name)),
        disabled: syncing,
        onUpdate: (checked: boolean) => { void onToggleEnabled(item.name, checked); },
      })),
      actions: [
        {
          id: "sync",
          label: primaryActionLabel,
          tone: "primary",
          loading: computed(() => syncing.value && !busyName.value),
          disabled: computed(() => !enabledCount.value || (syncing.value && Boolean(busyName.value))),
          run: syncFixtures,
        },
      ],
    },
  ]),
});
</script>

<template>
  <div class="page tool-page test-fixtures-page">
    <PageHeader title="检出测试工程" page-id="test_fixtures">
      <template #actions>
        <el-button
          type="primary"
          size="small"
          :loading="syncing && !busyName"
          :disabled="!enabledCount || (syncing && !!busyName)"
          @click="syncFixtures"
        >
          {{ primaryActionLabel }}
        </el-button>
        <el-button size="small" :disabled="loading || syncing" @click="reload">刷新状态</el-button>
      </template>
    </PageHeader>

    <section class="section">
      <div class="row checkout-row">
        <el-tooltip :content="checkoutRootHint" placement="top" :show-after="280">
          <label class="field-label-inline field-label-tip">本机检出根目录</label>
        </el-tooltip>
        <el-input
          v-model="checkoutRootInput"
          spellcheck="false"
          placeholder="默认：桌面应用数据目录；开发态为仓库上一级"
          :disabled="syncing"
        />
        <el-button :disabled="syncing" title="填入默认检出根目录" @click="useDefaultCheckoutRoot">默认</el-button>
        <el-button :loading="pickingRoot" :disabled="syncing" @click="browseCheckoutRoot">浏览…</el-button>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">可引用的测试工程</h2>
        <span class="section-meta">
          系统内置 {{ items.length }} 项 · 已勾选 {{ enabledCount }} · 已检出 {{ checkedOutCount }}
        </span>
      </div>
      <p class="section-hint muted small">
        清单由产品配置，不可在本页增删。勾选表示启用；点击「检出」后会将仓库克隆到上方目录中的同名子目录。
      </p>

      <div v-loading="loading" class="fixture-list">
        <article
          v-for="row in items"
          :key="row.name"
          class="fixture-card"
          :class="{ enabled: isEnabled(row.name), checkedOut: row.checkout_exists }"
        >
          <div class="fixture-card-head">
            <el-checkbox
              :model-value="isEnabled(row.name)"
              :disabled="syncing"
              @change="(v: boolean) => onToggleEnabled(row.name, v)"
            >
              <span class="fixture-name">{{ row.name }}</span>
              <span v-if="busyName === row.name" class="fixture-busy">处理中…</span>
            </el-checkbox>
            <div class="fixture-tags">
              <el-tag type="info" size="small" effect="plain">系统内置</el-tag>
              <el-tag v-if="isEnabled(row.name)" type="primary" size="small" effect="plain">要引用</el-tag>
              <el-tag v-else type="info" size="small" effect="plain">未启用</el-tag>
              <el-tag :type="statusTagType(row)" size="small" effect="plain">{{ checkoutLabel(row) }}</el-tag>
            </div>
          </div>
          <p class="fixture-desc">{{ row.description }}</p>
          <dl class="fixture-meta">
            <div class="meta-row">
              <dt>检出路径</dt>
              <dd><code>{{ checkoutPath(row.name) }}</code></dd>
            </div>
            <div class="meta-row">
              <dt>检出目录</dt>
              <dd class="mono" :title="row.checkout_path">{{ row.checkout_path }}</dd>
            </div>
            <div class="meta-row">
              <dt>仓库</dt>
              <dd>
                <a :href="row.clone_url" target="_blank" rel="noopener noreferrer">{{ row.clone_url }}</a>
              </dd>
            </div>
            <div v-if="row.link_detail && needsSetup(row)" class="meta-row">
              <dt>说明</dt>
              <dd class="muted">{{ row.link_detail }}</dd>
            </div>
          </dl>
          <div v-if="needsSetup(row)" class="card-actions">
            <el-button size="small" type="primary" :loading="syncing && busyName === row.name" :disabled="syncing && busyName !== row.name" @click="applySync(row.name)">
              {{ checkoutActionLabel(row) }}
            </el-button>
          </div>
        </article>
        <el-empty v-if="!loading && !items.length" description="内置 catalog 中无可引用工程" />
      </div>
    </section>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.section {
  margin-bottom: 20px;
}

.section-title {
  margin: 0;
  font-size: 1rem;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.section-meta {
  font-size: 0.82rem;
  color: var(--muted);
  white-space: nowrap;
}

.section-hint {
  margin: -4px 0 10px;
  line-height: 1.5;
}

.fixture-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fixture-card {
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  padding: 12px 14px;
  background: #fff;
}

.fixture-card.enabled {
  border-color: #93c5fd;
  background: #f8fbff;
}

.fixture-card.checkedOut {
  box-shadow: inset 3px 0 0 #22c55e;
}

.fixture-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.fixture-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.fixture-busy {
  margin-left: 8px;
  font-size: 0.78rem;
  font-weight: normal;
  color: var(--muted);
}

.fixture-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fixture-desc {
  margin: 8px 0 10px;
  font-size: 0.84rem;
  color: var(--muted);
  line-height: 1.5;
}

.card-actions {
  margin-top: 10px;
}

.fixture-meta {
  margin: 0;
  display: grid;
  gap: 6px;
}

.meta-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px;
  align-items: start;
  font-size: 0.8rem;
}

.meta-row dt {
  margin: 0;
  color: var(--muted);
}

.meta-row dd {
  margin: 0;
  word-break: break-all;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
}

.field-label {
  display: block;
  margin: 0 0 6px;
  font-size: 0.85rem;
  color: var(--muted);
}

.field-label-inline {
  flex-shrink: 0;
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
  white-space: nowrap;
}

.field-label-tip {
  cursor: help;
  border-bottom: 1px dotted var(--muted);
}

.checkout-row :deep(.el-tooltip__trigger) {
  display: inline-flex;
  flex-shrink: 0;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.row :deep(.el-input) {
  flex: 1;
}

.muted {
  color: var(--muted);
}

code {
  font-size: 0.78rem;
}
</style>
