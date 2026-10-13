<script setup lang="ts">
import { computed } from "vue";
import type { RenamePreview, RenameResults, RenameRow } from "./api";
const props = defineProps<{ preview: RenamePreview; results: RenameResults | null; disabled: boolean; consumed?: boolean; totalRows?: number; allRows?: RenameRow[] }>();
const selected = defineModel<string[]>("selected", { required: true });
const directoryMoves = computed(() => {
  const ids = new Set(selected.value);
  return (props.allRows || props.preview.rows).filter(item => item.kind === "directory" && item.eligible && ids.has(item.id)).flatMap(item => {
    if (!props.results) return [item];
    const result = props.results.results.find(row => row.id === item.id);
    return result?.status === "applied" ? [{ ...item, target: result.target }] : [];
  }).sort((a, b) => b.rel.length - a.rel.length);
});
function displayTarget(row: RenameRow) {
  const result = props.results?.results.find(item => item.id === row.id);
  if (result) return result.target;
  let target = props.results ? row.rel : row.target;
  for (const parent of directoryMoves.value) {
    if (parent.root !== row.root || !row.rel.startsWith(parent.rel + "/")) continue;
    if (target.startsWith(parent.rel + "/")) target = parent.target + target.slice(parent.rel.length);
  }
  return target;
}
</script>
<template>
  <div>
    <p v-for="conflict in preview.conflicts" :key="conflict" class="error" role="alert">{{ conflict }}</p>
    <details v-if="preview.excluded_rules?.length" class="excluded-rules" open><summary>未参与改名的规则（{{ preview.excluded_rules.length }}）· 其余规则继续处理</summary><table><thead><tr><th>#</th><th>原规则行</th><th>旧名 A → 新名 B</th><th>跳过原因</th></tr></thead><tbody><tr v-for="(rule, index) in preview.excluded_rules" :key="rule.row"><td>{{ index + 1 }}</td><td>{{ rule.row }}</td><td>{{ rule.old }} → {{ rule.target }}</td><td>{{ rule.reason }}</td></tr></tbody></table></details>
    <small>扫描 {{ preview.scanned }} 个 · 忽略 {{ preview.skipped }} 项<template v-if="results"> · 已应用 {{ results.applied }} / 失败 {{ results.failed }}</template></small>
    <table><thead><tr><th>#</th><th>选择</th><th>文件 / 文件夹 / 差异</th><th>状态</th></tr></thead><tbody>
      <tr v-for="(row, index) in preview.rows" :key="row.id"><td>{{ allRows ? allRows.findIndex(item => item.id === row.id) + 1 : index + 1 }}</td><td><input v-model="selected" type="checkbox" :value="row.id" :aria-label="`选择${row.kind === 'directory' ? '文件夹' : '文件'} ${row.rel}`" :disabled="disabled || !row.eligible || !!preview.conflicts.length" /></td><td><small>{{ row.root }}</small><small v-if="row.kind === 'directory'">文件夹（包含子项路径）</small><code>{{ row.rel }}</code><template v-if="displayTarget(row) !== row.rel"> → <strong>{{ displayTarget(row) }}</strong></template>
        <details v-if="row.diffs.length"><summary>文本 {{ row.occurrences }} 处{{ row.truncated ? '（部分差异）' : '' }}</summary><div v-for="diff in row.diffs" :key="diff.line"><small>第 {{ diff.line }} 行</small><pre class="removed">− {{ diff.before }}</pre><pre class="added">+ {{ diff.after }}</pre></div></details><small v-if="row.binary">二进制 / 大文件：不修改内容</small>
      </td><td><span :class="{ error: !row.eligible || results?.results.find(item => item.id === row.id)?.status === 'failed' }">{{ results?.results.find(item => item.id === row.id)?.message || (consumed && row.eligible ? '未应用（未选择或请求未确认完成）' : row.message) }}</span><small>{{ results?.results.find(item => item.id === row.id)?.backup }}</small></td></tr>
      <tr v-if="!preview.rows.length"><td colspan="4">{{ preview.conflicts.length ? '先解决规则冲突' : (totalRows || 0) > 0 ? '当前后缀筛选无匹配文件' : '没有需要修改的文件' }}</td></tr>
    </tbody></table>
    <details v-if="preview.warnings.length"><summary>扫描提示（{{ preview.warnings.length }}）</summary><p v-for="warning in preview.warnings" :key="warning">{{ warning }}</p></details>
  </div>
</template>
<style scoped>
table { width: 100%; border-collapse: collapse; font-size: .82rem; } th, td { border: 1px solid var(--border); padding: 7px; vertical-align: top; text-align: left; overflow-wrap: anywhere; } th { background: var(--panel-head-bg); } th:first-child { width: 48px; white-space: nowrap; } th:last-child { width: 24%; }
small { display: block; color: var(--muted); font-size: .75rem; margin: 4px 0; } summary { cursor: pointer; padding: 4px 0; } pre { margin: 0; padding: 3px 5px; white-space: pre-wrap; overflow-wrap: anywhere; }.error { color: var(--phoenix-danger-text); }.removed { color: var(--phoenix-danger-text); background: var(--phoenix-danger-bg); }.added { color: var(--phoenix-success-text); background: var(--phoenix-success-bg); }
.excluded-rules { margin-bottom: 12px; padding: 8px; background: var(--phoenix-warning-bg); }
</style>
