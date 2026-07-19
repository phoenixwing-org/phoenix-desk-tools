<script setup lang="ts">
import type { AssemblyTreeNode } from "../../api";
import type { AssemblyTreeInstanceViewInput } from "../../models/assemblyTreeViewModel";
import {
  assemblyTreeCanEditLabel,
  assemblyTreeDisplayLabel,
  assemblyTreeEditKey as editKey,
  assemblyTreeInstanceRows,
  assemblyTreeInstancesOf as instancesOf,
  assemblyTreeIsAssembly as isAssemblyNode,
  assemblyTreeIsLabelEdited,
  assemblyTreeIsMissing as isMissingNode,
  assemblyTreeIsResolved as isResolvedNode,
  assemblyTreeIsUnresolved as isUnresolved,
  assemblyTreeMissingRowTitle as missingRowTitle,
  assemblyTreePrimaryXlinkAttr as primaryXlinkAttr,
  assemblyTreeRole as resolveRole,
  assemblyTreeRoleLabel as roleLabel,
  assemblyTreeRowStatusClass as rowStatusClass,
  assemblyTreeStatusLabel as statusLabel,
  assemblyTreeToggleAriaLabel,
  assemblyTreeToggleVisualState,
} from "../../models/assemblyTreeViewModel";
import { resolveRuleLabelForNode } from "../../utils/fcstdRuleLabel";
import ExpandCaret from "phoenix-wing/components/PnwExpandCaret.vue";

const props = defineProps<{
  node: AssemblyTreeNode;
  depth: number;
  edits: ReadonlyMap<string, string>;
  treeExpanded: boolean;
  instanceExpanded: boolean;
  hasSubtree: boolean;
  subtreeLoading: boolean;
  editable: boolean;
  xlinkReplace: boolean;
  showXlinkActionCol: boolean;
}>();

const emit = defineEmits<{
  toggle: [node: AssemblyTreeNode];
  "toggle-instances": [node: AssemblyTreeNode];
  "label-input": [node: AssemblyTreeNode, instance: AssemblyTreeInstanceViewInput, value: string];
  "open-file": [node: AssemblyTreeNode];
  "replace-xlink": [node: AssemblyTreeNode];
}>();

function displayLabel(host: string, instance: AssemblyTreeInstanceViewInput): string {
  return assemblyTreeDisplayLabel(props.edits, host, instance);
}

function isLabelEdited(host: string, instance: AssemblyTreeInstanceViewInput): boolean {
  return assemblyTreeIsLabelEdited(props.edits, host, instance);
}

function canEditLinkLabel(node: AssemblyTreeNode): boolean {
  return assemblyTreeCanEditLabel(node, props.editable);
}

function canExpand(node: AssemblyTreeNode): boolean {
  return props.hasSubtree || isAssemblyNode(node);
}

function expandedSet(node: AssemblyTreeNode): ReadonlySet<string> {
  return props.treeExpanded ? new Set([node.id]) : new Set();
}

function loadingSet(node: AssemblyTreeNode): ReadonlySet<string> {
  return props.subtreeLoading ? new Set([node.id]) : new Set();
}

function toggleVisualState(node: AssemblyTreeNode) {
  return assemblyTreeToggleVisualState(
    node,
    expandedSet(node),
    loadingSet(node),
    props.hasSubtree,
  );
}

function toggleAriaLabel(node: AssemblyTreeNode): string {
  return assemblyTreeToggleAriaLabel(
    node,
    expandedSet(node),
    loadingSet(node),
    props.hasSubtree,
  );
}

function instanceExtraRows(node: AssemblyTreeNode, depth: number) {
  return assemblyTreeInstanceRows(
    node,
    depth,
    props.instanceExpanded ? new Set([node.id]) : new Set(),
  );
}

function roleIconClass(node: AssemblyTreeNode) {
  const role = resolveRole(node);
  return {
    "icon-assembly": role === "assembly",
    "icon-part": role === "part",
    "icon-drawing": role === "drawing",
    "icon-broken": isUnresolved(node),
  };
}

function canReplaceXlink(node: AssemblyTreeNode): boolean {
  return props.xlinkReplace && Boolean(primaryXlinkAttr(node));
}

function onLabelInput(
  node: AssemblyTreeNode,
  instance: AssemblyTreeInstanceViewInput,
  event: Event,
): void {
  emit("label-input", node, instance, (event.target as HTMLInputElement).value);
}
</script>

<template>
  <tr :class="rowStatusClass(node)">
    <td class="tree-cell">
      <div
        class="tree-item"
        :class="{ 'tree-item-missing': isMissingNode(node) }"
        :style="{ paddingLeft: `${depth * 18 + 4}px` }"
      >
        <button
          type="button"
          class="pnw-expand-btn toggle"
          :class="[`toggle-${toggleVisualState(node)}`, { leaf: !canExpand(node) }]"
          :disabled="!canExpand(node) || subtreeLoading"
          :aria-expanded="hasSubtree ? treeExpanded : isAssemblyNode(node) ? false : undefined"
          :aria-label="toggleAriaLabel(node)"
          :title="
            isAssemblyNode(node) && !hasSubtree
              ? '点击加载该装配的下级子件'
              : toggleAriaLabel(node)
          "
          @click="emit('toggle', node)"
        >
          <span
            v-if="toggleVisualState(node) === 'leaf'"
            class="toggle-leaf-dot"
            aria-hidden="true"
          />
          <ExpandCaret
            v-else-if="toggleVisualState(node) !== 'loading'"
            :expanded="
              toggleVisualState(node) === 'expanded'
                || (toggleVisualState(node) === 'lazy' && treeExpanded)
            "
          />
        </button>
        <span
          class="role-icon"
          :class="[
            roleIconClass(node),
            {
              'role-icon-dirty':
                canEditLinkLabel(node)
                && instancesOf(node)[0]
                && isLabelEdited(node.host_repo_rel, instancesOf(node)[0]),
            },
          ]"
          :title="
            canEditLinkLabel(node)
              && instancesOf(node)[0]
              && isLabelEdited(node.host_repo_rel, instancesOf(node)[0])
              ? `${roleLabel(resolveRole(node))} · 链接标签已修改未保存`
              : roleLabel(resolveRole(node))
          "
        >
          <span
            v-if="
              canEditLinkLabel(node)
                && instancesOf(node)[0]
                && isLabelEdited(node.host_repo_rel, instancesOf(node)[0])
            "
            class="role-dirty-badge"
            aria-label="链接标签已修改未保存"
          />
        </span>
        <div class="tree-body">
          <div class="tree-label-row">
            <input
              v-if="canEditLinkLabel(node) && instancesOf(node)[0]"
              :key="`${node.id}-${editKey(node.host_repo_rel, instancesOf(node)[0].xlink_file_attr)}`"
              class="label-input"
              :class="{
                'label-input-edited': isLabelEdited(
                  node.host_repo_rel,
                  instancesOf(node)[0],
                ),
              }"
              :value="displayLabel(node.host_repo_rel, instancesOf(node)[0])"
              spellcheck="false"
              :placeholder="resolveRuleLabelForNode(node) || '链接标签'"
              @input="onLabelInput(node, instancesOf(node)[0], $event)"
            />
            <span
              v-else-if="isMissingNode(node)"
              class="tree-label-read muted"
              :title="missingRowTitle(node)"
            >
              {{ node.link_label || node.basename || "—" }}
            </span>
            <span v-else class="tree-label-read">{{ node.link_label || "—" }}</span>
          </div>
          <div v-if="isUnresolved(node) && !isMissingNode(node)" class="tree-issue">
            <span class="issue-icon" :title="statusLabel(node.resolve_status)">⚠</span>
            <span class="issue-text">{{ statusLabel(node.resolve_status) }}</span>
            <span
              v-if="primaryXlinkAttr(node)"
              class="issue-xlink mono"
              :title="primaryXlinkAttr(node)"
            >
              {{ primaryXlinkAttr(node) }}
            </span>
          </div>
        </div>
      </div>
    </td>
    <td class="col-file mono">
      <button
        v-if="node.repo_rel_path"
        type="button"
        class="file-link"
        :title="node.repo_rel_path"
        @click="emit('open-file', node)"
      >
        {{ node.basename }}
      </button>
      <span v-else :title="primaryXlinkAttr(node) || undefined">{{ node.basename }}</span>
    </td>
    <td class="col-qty">
      <button
        v-if="(node.ref_count ?? 1) > 1 && canEditLinkLabel(node)"
        type="button"
        class="qty-btn"
        :title="instanceExpanded ? '折叠各实例' : '展开编辑各实例标签'"
        @click="emit('toggle-instances', node)"
      >
        {{ node.ref_count }}
        <ExpandCaret inline :expanded="instanceExpanded" />
      </button>
      <span v-else class="qty-num">{{ node.ref_count ?? 1 }}</span>
    </td>
    <td class="col-status">
      <span v-if="isMissingNode(node)" class="status-badge missing">缺失</span>
      <span v-else-if="node.resolve_status === 'ambiguous'" class="status-badge ambiguous">歧义</span>
      <span v-else-if="isResolvedNode(node)" class="status-ok" title="已解析">✓</span>
      <span v-else class="status-muted muted">{{ statusLabel(node.resolve_status) }}</span>
    </td>
    <td v-if="showXlinkActionCol" class="col-action">
      <button
        v-if="canReplaceXlink(node)"
        type="button"
        class="btn-row-action"
        title="搜索候选并写回该宿主装配内此 XLink（已解析/缺失均可，宿主可能为子装配）"
        @click="emit('replace-xlink', node)"
      >
        改链接
      </button>
      <span v-else class="muted">—</span>
    </td>
  </tr>
  <tr
    v-for="extra in instanceExtraRows(node, depth)"
    :key="`${node.id}-inst-${extra.instanceIndex}`"
    class="instance-row"
  >
    <td class="tree-cell" colspan="1">
      <div class="tree-item instance-indent" :style="{ paddingLeft: `${depth * 18 + 36}px` }">
        <span
          class="role-icon icon-instance"
          :class="{
            'role-icon-dirty':
              canEditLinkLabel(node) && isLabelEdited(node.host_repo_rel, extra.instance),
          }"
          :title="
            isLabelEdited(node.host_repo_rel, extra.instance)
              ? '同目标多实例 · 链接标签已修改未保存'
              : '同目标多实例'
          "
        >
          <span
            v-if="canEditLinkLabel(node) && isLabelEdited(node.host_repo_rel, extra.instance)"
            class="role-dirty-badge"
            aria-label="链接标签已修改未保存"
          />
        </span>
        <div class="tree-body">
          <div class="tree-label-row">
            <span class="muted instance-tag">#{{ extra.instanceIndex + 1 }}</span>
            <input
              v-if="canEditLinkLabel(node)"
              class="label-input"
              :class="{
                'label-input-edited': isLabelEdited(node.host_repo_rel, extra.instance),
              }"
              :value="displayLabel(node.host_repo_rel, extra.instance)"
              spellcheck="false"
              @input="onLabelInput(node, extra.instance, $event)"
            />
          </div>
        </div>
      </div>
    </td>
    <td class="col-file muted instance-hint">—</td>
    <td class="col-qty muted instance-hint">—</td>
    <td class="col-status muted instance-hint">—</td>
    <td v-if="showXlinkActionCol" class="col-action muted">—</td>
  </tr>
</template>

<style scoped>
td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

.tree-cell {
  vertical-align: top;
}

.tree-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.tree-item-missing {
  align-items: center;
}

.tree-body {
  flex: 1;
  min-width: 0;
}

.tree-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.tree-label-read {
  font-weight: 600;
  font-size: 0.84rem;
}

.col-file {
  min-width: var(--asm-tree-file-min-width, 160px);
  max-width: var(--asm-tree-file-max-width, 280px);
  font-size: 0.76rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-issue {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-top: 4px;
  font-size: 0.72rem;
  color: #b45309;
}

.issue-icon {
  font-size: 0.85rem;
  line-height: 1;
}

.issue-xlink {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #92400e;
}

.role-icon {
  position: relative;
  flex-shrink: 0;
  align-self: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: #e2e8f0 center / 14px 14px no-repeat;
}

.role-icon-dirty {
  box-shadow: 0 0 0 1px #fdba74;
}

.role-dirty-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c2410c;
  border: 1.5px solid #fff;
  pointer-events: none;
}

.role-icon.icon-assembly {
  background-color: #dbeafe;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%231d4ed8'%3E%3Cpath d='M2 5h5V2h2v3h5v2h-5v5H9V7H2V5z'/%3E%3C/svg%3E");
}

.role-icon.icon-part {
  background-color: #f1f5f9;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23475569'%3E%3Cpath d='M3 3h10v10H3V3zm2 2v6h6V5H5z'/%3E%3C/svg%3E");
}

.role-icon.icon-drawing {
  background-color: #fef3c7;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23b45309'%3E%3Cpath d='M4 2h8l2 2v10H4V2zm1 3h6v1H5V5zm0 2h6v1H5V7zm0 2h4v1H5V9z'/%3E%3C/svg%3E");
}

.role-icon.icon-broken {
  box-shadow: inset 0 -2px 0 #f59e0b;
}

.role-icon.icon-instance {
  background-color: #f8fafc;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%2394a3b8'%3E%3Ccircle cx='8' cy='8' r='3'/%3E%3C/svg%3E");
}

.toggle {
  align-self: center;
  margin: 0 1px 0 0;
}

.toggle-leaf-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #cbd5e1;
}

.toggle-loading {
  font-size: 0.9rem;
  font-weight: 600;
  color: #64748b;
}

.toggle-loading .pnw-expand-twistie {
  display: none;
}

.toggle-loading::after {
  content: "…";
  line-height: 1;
}

.toggle.leaf {
  cursor: default;
}

.toggle.leaf:hover {
  background: transparent;
}

.label-input {
  flex: 1;
  min-width: 120px;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 0.84rem;
  font-weight: 600;
  box-sizing: border-box;
  background: #fff;
}

.label-input-edited {
  background: #fff7ed;
  border-color: #fdba74;
}

.col-qty {
  width: var(--asm-tree-qty-width, 52px);
  text-align: center;
}

.col-status {
  width: var(--asm-tree-status-width, 56px);
  text-align: center;
  vertical-align: middle;
}

.status-ok {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #d1fae5;
  color: #047857;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1;
}

.status-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
}

.status-badge.missing {
  background: #fee2e2;
  color: #b91c1c;
}

.status-badge.ambiguous {
  background: #fef3c7;
  color: #b45309;
}

.status-muted {
  font-size: 0.72rem;
}

.qty-btn {
  padding: 2px 8px;
  border: 1px solid #93c5fd;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.qty-num {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--text);
}

.instance-row {
  background: #fafbfc;
}

.instance-indent,
.instance-tag,
.instance-hint {
  font-size: 0.72rem;
}

tr.row-missing {
  background: #fffbeb;
}

tr.row-ambiguous {
  background: #fff7ed;
}

.col-action {
  width: var(--asm-tree-action-width, 72px);
  white-space: nowrap;
}

.btn-row-action {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  background: #fff;
  font-size: 0.74rem;
  cursor: pointer;
}

.btn-row-action:hover {
  background: #f0f9ff;
  border-color: #7dd3fc;
  color: #0369a1;
}

.file-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent, #2563eb);
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.file-link:hover {
  text-decoration: underline;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-size: 0.76rem;
}

.muted {
  color: var(--muted);
}
</style>
