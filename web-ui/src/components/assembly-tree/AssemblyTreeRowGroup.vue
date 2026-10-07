<script setup lang="ts">
import { computed } from "vue";
import type { AssemblyTreeNode } from "../../api";
import type { AssemblyTreeInstanceViewInput } from "../../models/assemblyTreeViewModel";
import {
  assemblyTreeCanEditLabel,
  assemblyTreeCanLoadSourceChildren,
  assemblyTreeDisplayLabel,
  assemblyTreeEditKey as editKey,
  assemblyTreeInstanceRows,
  assemblyTreeInstancesOf as instancesOf,
  assemblyTreeIsLabelEdited,
  assemblyTreeLabelRecommendation,
  assemblyTreeLabelDiffersFromRule,
  assemblyTreeTargetFile,
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
  position?: string;
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
  "apply-label-instance": [node: AssemblyTreeNode, instance: AssemblyTreeInstanceViewInput];
}>();

function displayLabel(host: string, instance: AssemblyTreeInstanceViewInput): string {
  return assemblyTreeDisplayLabel(props.edits, host, instance);
}

function isLabelEdited(host: string, instance: AssemblyTreeInstanceViewInput): boolean {
  return assemblyTreeIsLabelEdited(props.edits, host, instance);
}

function recommendation(instance?: AssemblyTreeInstanceViewInput): string {
  if (!instance || !assemblyTreeLabelDiffersFromRule(props.node, instance, displayLabel(props.node.host_repo_rel, instance))) return "";
  return assemblyTreeLabelRecommendation(props.node, instance);
}

const primaryRecommendation = computed(() => recommendation(instancesOf(props.node)[0]));
const hasRecommendations = computed(() => instancesOf(props.node).some(instance => recommendation(instance)));
const hasDrafts = computed(() => instancesOf(props.node).some(instance => isLabelEdited(props.node.host_repo_rel, instance)));
const primaryTarget = computed(() => assemblyTreeTargetFile(props.node));

function targetTitle(instance?: AssemblyTreeInstanceViewInput): string {
  const target = assemblyTreeTargetFile(props.node, instance);
  return target.repoRelPath + (target.viaRepoRelPath ? `\n经由：${target.viaRepoRelPath}` : "");
}

function openTargetFile(instance?: AssemblyTreeInstanceViewInput) {
  const target = assemblyTreeTargetFile(props.node, instance);
  if (target.repoRelPath) emit("open-file", { ...props.node, repo_rel_path: target.repoRelPath, basename: target.basename });
}

function canEditLinkLabel(node: AssemblyTreeNode): boolean {
  return assemblyTreeCanEditLabel(node, props.editable);
}

function canExpand(node: AssemblyTreeNode): boolean {
  return props.hasSubtree || assemblyTreeCanLoadSourceChildren(node);
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
    <td class="col-position">{{ position }}</td>
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
          :aria-expanded="hasSubtree ? treeExpanded : assemblyTreeCanLoadSourceChildren(node) ? false : undefined"
          :aria-label="toggleAriaLabel(node)"
          :title="
            assemblyTreeCanLoadSourceChildren(node) && !hasSubtree
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
              :key="`${node.id}-${editKey(node.host_repo_rel, instancesOf(node)[0].xlink_file_attr, instancesOf(node)[0])}`"
              class="label-input"
              :class="{
                'label-input-mismatch': Boolean(primaryRecommendation),
                'label-input-edited': isLabelEdited(
                  node.host_repo_rel,
                  instancesOf(node)[0],
                ),
              }"
              :value="displayLabel(node.host_repo_rel, instancesOf(node)[0])"
              :title="`原名：${instancesOf(node)[0].link_label ?? ''}\n建议：${instancesOf(node)[0].rule_label ?? ''}`"
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
            <span v-else class="tree-label-read" :title="node.label_edit_reason">{{ node.link_label || "—" }}</span>
          </div>
          <div v-if="primaryRecommendation" class="label-recommendation" :title="`推荐：${primaryRecommendation}`">
            <span>推荐：</span><span class="recommendation-name">{{ primaryRecommendation }}</span>
            <button v-if="canEditLinkLabel(node)" type="button" class="btn-recommendation" title="只将此推荐名填入本行，应用后才写盘"
              @click="emit('label-input', node, instancesOf(node)[0], primaryRecommendation)">填入</button>
          </div>
          <small v-if="instancesOf(node)[0]?.rule_error" class="tree-issue">{{ instancesOf(node)[0].rule_error }}</small>
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
    <td class="col-qty">
      <button
        v-if="(node.ref_count ?? 1) > 1 && instancesOf(node).length > 1"
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
      <span v-else-if="instancesOf(node).some(instance => instance.rule_error)" class="status-badge ambiguous">需确认</span>
      <span v-else-if="hasDrafts" class="status-badge ambiguous">待应用</span>
      <span v-else-if="hasRecommendations" class="status-badge ambiguous">待修正</span>
      <span v-else-if="isResolvedNode(node)" class="status-ok" title="已解析">✓</span>
      <span v-else class="status-muted muted">{{ statusLabel(node.resolve_status) }}</span>
    </td>
    <td class="col-file mono">
      <button
        v-if="primaryTarget.repoRelPath"
        type="button"
        class="file-link"
        :title="targetTitle()"
        @click="openTargetFile()"
      >
        {{ primaryTarget.basename }}
      </button>
      <span v-else :title="primaryXlinkAttr(node) || undefined">{{ primaryTarget.basename }}</span>
      <div v-if="showXlinkActionCol" class="row-actions" role="group" aria-label="本行操作">
      <div v-if="canEditLinkLabel(node) && instancesOf(node)[0] && isLabelEdited(node.host_repo_rel, instancesOf(node)[0])" class="label-row-actions">
        <button type="button" class="btn-row-action" title="恢复本行预览前的标签" @click="emit('label-input', node, instancesOf(node)[0], instancesOf(node)[0].link_label ?? '')">撤销</button>
        <button type="button" class="btn-row-action apply-row" title="只写入这一行，保留其他行修改" @click="emit('apply-label-instance', node, instancesOf(node)[0])">应用</button>
      </div>
      <button
        v-if="canReplaceXlink(node)"
        type="button"
        class="btn-row-action"
        title="搜索候选并写回该宿主装配内此 XLink（已解析/缺失均可，宿主可能为子装配）"
        @click="emit('replace-xlink', node)"
      >
        改链接
      </button>
      </div>
    </td>
  </tr>
  <tr
    v-for="extra in instanceExtraRows(node, depth)"
    :key="`${node.id}-inst-${extra.instanceIndex}`"
    class="instance-row"
  >
    <td class="col-position" :title="'同一位置的第 ' + (extra.instanceIndex + 1) + ' 个实例'">{{ position }} · {{ extra.instanceIndex + 1 }}</td>
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
                'label-input-mismatch': Boolean(recommendation(extra.instance)),
                'label-input-edited': isLabelEdited(node.host_repo_rel, extra.instance),
              }"
              :value="displayLabel(node.host_repo_rel, extra.instance)"
              :title="`原名：${extra.instance.link_label ?? ''}\n建议：${extra.instance.rule_label ?? ''}`"
              spellcheck="false"
              @input="onLabelInput(node, extra.instance, $event)"
            />
            <span v-else class="tree-label-read">{{ extra.instance.link_label || "—" }}</span>
          </div>
          <div v-if="recommendation(extra.instance)" class="label-recommendation" :title="`推荐：${recommendation(extra.instance)}`">
            <span>推荐：</span><span class="recommendation-name">{{ recommendation(extra.instance) }}</span>
            <button v-if="canEditLinkLabel(node)" type="button" class="btn-recommendation" title="只将此推荐名填入本行，应用后才写盘"
              @click="emit('label-input', node, extra.instance, recommendation(extra.instance))">填入</button>
          </div>
          <small v-if="extra.instance.rule_error" class="tree-issue">{{ extra.instance.rule_error }}</small>
        </div>
      </div>
    </td>
    <td class="col-qty muted instance-hint">—</td>
    <td class="col-status">
      <span v-if="extra.instance.rule_error" class="status-badge ambiguous">需确认</span>
      <span v-else-if="isLabelEdited(node.host_repo_rel, extra.instance)" class="status-badge ambiguous">待应用</span>
      <span v-else-if="recommendation(extra.instance)" class="status-badge ambiguous">待修正</span>
      <span v-else class="muted instance-hint">—</span>
    </td>
    <td class="col-file mono instance-hint">
      <button v-if="assemblyTreeTargetFile(node, extra.instance).repoRelPath" type="button" class="file-link"
        :title="targetTitle(extra.instance)" @click="openTargetFile(extra.instance)">{{ assemblyTreeTargetFile(node, extra.instance).basename }}</button>
      <span v-else>—</span>
      <div v-if="showXlinkActionCol && canEditLinkLabel(node) && isLabelEdited(node.host_repo_rel, extra.instance)" class="row-actions" role="group" aria-label="本实例操作">
        <button type="button" class="btn-row-action" title="恢复本行预览前的标签" @click="emit('label-input', node, extra.instance, extra.instance.link_label ?? '')">撤销</button>
        <button type="button" class="btn-row-action apply-row" title="只写入这一行，保留其他行修改" @click="emit('apply-label-instance', node, extra.instance)">应用</button>
      </div>
    </td>
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

.col-position { width: 1%; white-space: nowrap; color: var(--phoenix-text-muted); font-variant-numeric: tabular-nums; }

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
  position: relative;
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
  color: var(--phoenix-warning-text);
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
  color: var(--phoenix-warning-text);
}

.role-icon {
  position: relative;
  flex-shrink: 0;
  align-self: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: var(--phoenix-bg-elevated);
  color: var(--phoenix-text-secondary);
}

.role-icon::before {
  content: "";
  position: absolute;
  inset: 3px;
  background: currentColor;
  mask: var(--role-icon-image) center / contain no-repeat;
}

.role-icon-dirty {
  box-shadow: 0 0 0 1px var(--phoenix-warning-border);
}

.role-dirty-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--phoenix-warning-text);
  border: 1.5px solid var(--phoenix-bg-page);
  pointer-events: none;
}

.role-icon.icon-assembly {
  background-color: var(--phoenix-accent-soft);
  color: var(--phoenix-accent);
  --role-icon-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M2 5h5V2h2v3h5v2h-5v5H9V7H2V5z'/%3E%3C/svg%3E");
}

.role-icon.icon-part {
  --role-icon-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 3h10v10H3V3zm2 2v6h6V5H5z'/%3E%3C/svg%3E");
}

.role-icon.icon-drawing {
  background-color: var(--phoenix-warning-bg);
  color: var(--phoenix-warning-text);
  --role-icon-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 2h8l2 2v10H4V2zm1 3h6v1H5V5zm0 2h6v1H5V7zm0 2h4v1H5V9z'/%3E%3C/svg%3E");
}

.role-icon.icon-broken {
  box-shadow: inset 0 -2px 0 var(--phoenix-warning-border);
}

.role-icon.icon-instance {
  color: var(--phoenix-text-muted);
  --role-icon-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='3'/%3E%3C/svg%3E");
}

.toggle {
  align-self: center;
  margin: 0 1px 0 0;
}

.toggle-leaf-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--phoenix-text-muted);
}

.toggle-loading {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--phoenix-text-muted);
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
  background: var(--phoenix-bg-elevated);
  color: var(--phoenix-text);
}

.label-input-edited,
.label-input-mismatch {
  background: var(--phoenix-warning-bg);
  color: var(--phoenix-warning-text);
  border-color: var(--phoenix-warning-border);
}

.label-recommendation {
  display: flex;
  align-items: baseline;
  gap: 2px;
  min-width: 0;
  margin-top: 3px;
  color: var(--phoenix-warning-text);
  font-size: 0.72rem;
  white-space: nowrap;
}

.recommendation-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-recommendation {
  flex-shrink: 0;
  padding: 0 5px;
  border: 1px solid var(--phoenix-warning-border);
  border-radius: 4px;
  background: var(--phoenix-warning-bg);
  color: var(--phoenix-warning-text);
  font: inherit;
  line-height: 1.4;
  cursor: pointer;
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
  background: var(--phoenix-success-bg);
  color: var(--phoenix-success-text);
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1;
}

.status-badge {
  white-space: nowrap;
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
}

.status-badge.missing {
  background: var(--phoenix-danger-bg);
  color: var(--phoenix-danger-text);
}

.status-badge.ambiguous {
  background: var(--phoenix-warning-bg);
  color: var(--phoenix-warning-text);
}

.status-muted {
  font-size: 0.72rem;
}

.qty-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  padding: 2px 8px;
  border: 1px solid var(--phoenix-accent-border);
  border-radius: 999px;
  background: var(--phoenix-accent-soft);
  color: var(--phoenix-accent);
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
  background: var(--phoenix-bg-muted);
}

.instance-indent,
.instance-tag,
.instance-hint {
  font-size: 0.72rem;
}

tr.row-missing {
  background: var(--phoenix-warning-bg);
}

tr.row-ambiguous {
  background: var(--phoenix-warning-bg);
}

.row-actions {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  width: max-content;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--phoenix-bg-elevated);
  box-shadow: 0 2px 8px var(--phoenix-hover-overlay);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
}

tr:hover > .col-file > .row-actions,
tr:focus-within > .col-file > .row-actions {
  opacity: 1;
  pointer-events: auto;
}

.row-actions:empty { display: none; }

@media (hover: none) {
  .row-actions { opacity: 1; pointer-events: auto; }
}

.btn-row-action {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  background: var(--phoenix-bg-elevated);
  color: var(--phoenix-text);
  font-size: 0.74rem;
  cursor: pointer;
}

.btn-row-action:hover {
  background: var(--phoenix-accent-soft);
  border-color: var(--phoenix-accent-border);
  color: var(--phoenix-accent);
}

.label-row-actions { display: flex; flex-wrap: nowrap; gap: 4px; }
.apply-row { color: var(--phoenix-accent); border-color: var(--phoenix-accent-border); }

.file-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--phoenix-accent);
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
