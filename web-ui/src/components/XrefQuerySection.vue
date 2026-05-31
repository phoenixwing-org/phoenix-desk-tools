<script setup lang="ts">
import { ref } from "vue";
import {
  fetchBomXrefIncoming,
  fetchBomXrefOutgoing,
  type BomXrefEdge,
  type BomXrefHost,
} from "../api";
import type { useIncomingRefQuery } from "../composables/useIncomingRefQuery";
import { resolveOutgoingHostQuery } from "../utils/workspaceFileQuery";

type IncomingApi = ReturnType<typeof useIncomingRefQuery>;

const props = withDefaults(
  defineProps<{
    incoming: IncomingApi;
    embedded?: boolean;
    workbenchTabId?: string;
  }>(),
  { embedded: false },
);

type SearchMode = "incoming" | "outgoing";

const searchMode = ref<SearchMode>("incoming");
const incomingHosts = ref<BomXrefHost[]>([]);
const refs = ref<BomXrefEdge[]>([]);
const resultCount = ref(0);
const directCount = ref(0);
const loading = ref(false);
const pageError = ref("");
const searchAttempted = ref(false);
const searchSummary = ref<{ kind: "info" | "ok" | "warn" | "err"; text: string } | null>(null);

const {
  queryText,
  pickedRel,
  clearPickedOnInput,
  applyTreeSelection,
  registerTreeSelectHandler,
  unregisterTreeSelectHandler,
  includeTransitive,
  resolveIncomingQuery,
  describeIncomingQuery,
  formatHostSummary,
  logIncoming,
  transitiveLabel,
  setStatus,
} = props.incoming;

function resolveQuery() {
  if (searchMode.value === "outgoing") {
    return resolveOutgoingHostQuery(queryText.value, pickedRel.value);
  }
  return resolveIncomingQuery();
}

async function onSearch() {
  pageError.value = "";
  searchSummary.value = null;
  incomingHosts.value = [];
  refs.value = [];
  resultCount.value = 0;
  directCount.value = 0;

  const q = resolveQuery();
  if (!q) {
    const msg =
      searchMode.value === "outgoing"
        ? "请填写路径，或在右侧树中点击文件"
        : "请填写文件名（可部分），或在右侧树中点击文件";
    pageError.value = msg;
    searchSummary.value = { kind: "warn", text: msg };
    logIncoming(`引用查询取消：${msg}`);
    return;
  }

  const modeLabel = searchMode.value === "incoming" ? "入向" : "出向";
  if (searchMode.value === "incoming") {
    logIncoming(
      `引用查询 · ${modeLabel} · ${describeIncomingQuery(q)} · ${transitiveLabel()}`,
    );
  } else {
    logIncoming(`引用查询 · ${modeLabel} · rel=${q.rel}`);
  }

  loading.value = true;
  searchAttempted.value = true;
  try {
    if (searchMode.value === "incoming") {
      const data = await fetchBomXrefIncoming({
        rel: q.rel,
        basename: q.basename,
        transitive: includeTransitive.value,
      });
      incomingHosts.value = data.hosts;
      refs.value = data.refs;
      resultCount.value = data.count;
      directCount.value = data.direct_count ?? data.count;

      const text = formatHostSummary({
        hostCount: resultCount.value,
        directHostCount: directCount.value,
        edgeCount: refs.value.length,
        mode: "query",
      });
      searchSummary.value = {
        kind: resultCount.value > 0 ? "ok" : "warn",
        text:
          resultCount.value > 0
            ? text
            : `${text}。若预期应有引用，请确认 CAD 索引与引用表已构建。`,
      };
      logIncoming(text);
      setStatus(text);
    } else if (q.rel) {
      const data = await fetchBomXrefOutgoing(q.rel);
      refs.value = data.refs;
      resultCount.value = data.count;
      const text = `查询完成：出向引用 ${resultCount.value} 条`;
      searchSummary.value = {
        kind: resultCount.value > 0 ? "ok" : "warn",
        text:
          resultCount.value > 0
            ? text
            : `${text}。该文件可能未引用其他 FCStd，或引用表未覆盖。`,
      };
      logIncoming(text);
      setStatus(text);
    }
  } catch (e) {
    const msg = String(e);
    pageError.value = msg;
    searchSummary.value = { kind: "err", text: `查询失败：${msg}` };
    logIncoming(`引用查询失败：${msg}`);
    setStatus(`引用查询失败：${msg}`);
  } finally {
    loading.value = false;
  }
}

async function onTreeSelect(repoRel: string) {
  applyTreeSelection(repoRel);
  pageError.value = "";
  await onSearch();
}

function registerTreeHandler() {
  if (props.embedded) return;
  registerTreeSelectHandler(onTreeSelect);
}

function unregisterTreeHandler() {
  if (props.embedded) return;
  unregisterTreeSelectHandler();
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    resolved: "已解析",
    ambiguous: "歧义",
    missing: "未找到",
    self: "自引用",
    non_fcstd: "非 FCStd",
  };
  return map[status] ?? status;
}

defineExpose({ onSearch, registerTreeHandler, unregisterTreeHandler });
</script>

<template>
  <section class="xref-query">
    <h2 class="section-title">引用查询（只读）</h2>
    <p class="section-desc">
      查看谁引用了某文件（入向），或某装配引用了哪些子件（出向）。改名写回请用上方「分析引用」。
    </p>

    <div v-if="pageError" class="banner err">{{ pageError }}</div>

    <div class="search-block">
      <div class="mode-row">
        <label class="mode-opt">
          <input v-model="searchMode" type="radio" value="incoming" />
          谁引用了此文件（入向）
        </label>
        <label class="mode-opt">
          <input v-model="searchMode" type="radio" value="outgoing" />
          此文件引用了谁（出向）
        </label>
      </div>

      <div class="fields">
        <label class="field">
          <span class="label">{{ searchMode === "incoming" ? "文件名" : "宿主路径" }}</span>
          <input
            v-model="queryText"
            class="mono"
            spellcheck="false"
            :placeholder="
              searchMode === 'incoming'
                ? '部分文件名即可；或右侧树点击后点查询'
                : '相对路径，或右侧树点击'
            "
            @input="clearPickedOnInput"
            @keydown.enter.prevent="onSearch"
          />
        </label>
        <p v-if="pickedRel" class="picked-hint mono">已从树选择：{{ pickedRel }}</p>
        <label v-if="searchMode === 'incoming'" class="field chk-field">
          <span class="label" />
          <label class="chk">
            <input v-model="includeTransitive" type="checkbox" />
            含总装配等间接宿主（引用查询用传递闭包；改名分析仅列出本文件内确有 XLink 的宿主）
          </label>
        </label>
      </div>

      <button type="button" class="btn primary" :disabled="loading" @click="onSearch">
        {{ loading ? "查询中…" : "查询引用" }}
      </button>
    </div>

    <div v-if="searchSummary" class="banner" :class="searchSummary.kind">
      {{ searchSummary.text }}
    </div>

    <section
      v-if="searchAttempted && searchMode === 'incoming' && !loading && !incomingHosts.length"
      class="results empty-results"
    >
      <p class="empty">未找到引用此文件的宿主（0 条）。</p>
    </section>

    <section v-if="searchMode === 'incoming' && incomingHosts.length" class="results">
      <h3 class="sub-title">
        入向宿主（{{ resultCount }}）
        <span v-if="includeTransitive && directCount < resultCount" class="sub">
          · 直接 {{ directCount }} · 间接 {{ resultCount - directCount }}
        </span>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>宿主装配</th>
            <th>关系</th>
            <th>经子装配</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in incomingHosts" :key="row.host_repo_rel_path">
            <td class="mono">{{ row.host_repo_rel_path }}</td>
            <td>
              <span class="tag" :class="row.usage_kind">
                {{ row.depth === 0 ? "直接 XLink" : `间接 · 层级 ${row.depth}` }}
              </span>
            </td>
            <td class="mono muted">
              {{ row.via_chain.length ? row.via_chain.join(" → ") : "—" }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section
      v-else-if="searchAttempted && searchMode === 'outgoing' && !loading && !refs.length"
      class="results empty-results"
    >
      <p class="empty">未找到出向引用（0 条）。</p>
    </section>

    <section v-else-if="refs.length && searchMode === 'outgoing'" class="results">
      <h3 class="sub-title">出向引用（{{ resultCount }}）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>目标名</th>
            <th>目标路径</th>
            <th>解析</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in refs" :key="row.id">
            <td class="mono">{{ row.target_basename }}</td>
            <td class="mono muted">{{ row.target_repo_rel_path || "—" }}</td>
            <td>
              <span class="tag" :class="row.resolve_status">{{ statusLabel(row.resolve_status) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped>
.xref-query {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}

.section-title {
  margin: 0 0 4px;
  font-size: 0.95rem;
}

.section-desc {
  margin: 0 0 12px;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.5;
}

.sub-title {
  margin: 0 0 8px;
  font-size: 0.88rem;
}

.sub-title .sub {
  font-size: 0.78rem;
  font-weight: normal;
  color: var(--muted);
}

.banner.err {
  background: #fef2f2;
  color: #b91c1c;
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 0.85rem;
}

.banner.ok {
  background: #ecfdf5;
  color: #047857;
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 0.85rem;
}

.banner.warn {
  background: #fffbeb;
  color: #b45309;
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 0.85rem;
}

.search-block {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg, #fafafa);
}

.mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 0.85rem;
}

.fields {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  max-width: 560px;
}

.field {
  display: grid;
  grid-template-columns: 88px 1fr;
  align-items: center;
  gap: 8px;
}

.field .label {
  font-size: 0.82rem;
  color: var(--muted);
  text-align: right;
}

.field input {
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.picked-hint {
  margin: 0 0 0 96px;
  font-size: 0.78rem;
  color: #1d4ed8;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.data-table th,
.data-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}

.data-table th {
  background: var(--panel-bg, #f3f4f6);
  font-weight: 600;
}

.btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
  cursor: pointer;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.5;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
}

.muted {
  color: var(--muted);
}

.tag {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
  background: #e5e7eb;
}

.tag.resolved {
  background: #d1fae5;
  color: #047857;
}

.tag.ambiguous {
  background: #fef3c7;
  color: #b45309;
}

.tag.indirect {
  background: #dbeafe;
  color: #1d4ed8;
}

.chk-field {
  align-items: start;
}

.chk {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
}

.empty-results {
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
}

.empty-results .empty {
  margin: 0;
}
</style>
