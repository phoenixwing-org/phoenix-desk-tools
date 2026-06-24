<script setup lang="ts">
/**
 * 统一 NLS 文案编辑器 —— 树表格模式（默认）+ 平铺表模式，内部切换。
 * 树表格列：控件属性 | 英文 | 中文，对齐。
 */
import { computed, nextTick, ref, watch } from "vue";
import { nlsKeyForProp, nlsPathSegments, type NlsStringProp } from "@phoenix/catdlg-core";
import type { CaaDialogNode } from "../../types/caaDialogIr";
import { hasTitle, hasHelp } from "../../utils/caaControlBehaviors";
import { useCaaDialogPageStore } from "../../stores/caaDialogPage";

// ── types ──

type NlsTreeLocale = "en" | "cn";
type EditorMode = "tree" | "table";

interface NlsTreeLeaf {
  kind: "leaf";
  key: string;
  value: string;
  prop: NlsStringProp;
  nodeId: string;
  columnIndex?: number;
}

interface NlsTreeGroup {
  kind: "group";
  label: string;
  members: NlsTreeLeaf[];
  allSameValue: boolean;
}

interface NlsTreeControl {
  kind: "control";
  nodeId: string;
  nodeType: string;
  titleLeaf?: NlsTreeLeaf;
  groups: NlsTreeGroup[];
  keyCount: number;
}

// ── props / emits ──

const props = withDefaults(
  defineProps<{
    open: boolean;
    root: CaaDialogNode | null;
    enFlat: Record<string, string>;
    cnFlat?: Record<string, string>;
    compareMode?: boolean;
    dirty?: boolean;
    /** 滚动到指定控件 nodeId */
    /** 初始 locale 模式 */
    initialLocaleMode?: LocaleMode;
    /** 是否可添加简体中文 */
    canCreateCn?: boolean;
  }>(),
  { compareMode: false, dirty: false, canCreateCn: false },
);

const emit = defineEmits<{
  close: [];
  "update:value": [key: string, value: string, locale?: "en" | "cn"];
  /** 仅保存 NLS 文案（不写 .CATDlg） */
  save: [];
  /** 添加简体中文 locale */
  "create-cn": [];
}>();

/** 显示模式：en=仅英文, cn=仅中文, both=中英对照 */
type LocaleMode = "en" | "cn" | "both";
const localeMode = ref<LocaleMode>(props.initialLocaleMode ?? (props.cnFlat ? "both" : "en"));

/** auto-fill 中英空白值 */
function autoFill() {
  if (!props.cnFlat) return;
  const enFlat = props.enFlat;
  const cnFlat = props.cnFlat;
  const allKeys = new Set([...Object.keys(enFlat), ...Object.keys(cnFlat)]);
  for (const key of allKeys) {
    const enVal = (enFlat[key] ?? "").trim();
    const cnVal = (cnFlat[key] ?? "").trim();
    if (enVal && !cnVal) emit("update:value", key, enVal, "cn");
    else if (cnVal && !enVal) emit("update:value", key, cnVal, "en");
  }
}

const store = useCaaDialogPageStore();

// ── column resize ──

/** 根据可见列动态计算百分比 */
const colPct = computed(() => {
  const { ctrl, en, cn } = store.nlsColWidths;
  if (showCn.value && showEn.value) return { ctrl, en, cn }; // 三列
  if (showCn.value) return { ctrl, en: 0, cn: 100 - ctrl };   // 仅 CN
  return { ctrl, en: 100 - ctrl, cn: 0 };                       // 仅 EN
});

function onColResizeStart(col: "en" | "cn", e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const start = { ...store.nlsColWidths };
  const onMove = (ev: MouseEvent) => {
    const dx = ((ev.clientX - startX) / (document.querySelector(".caa-nls-panel")?.clientWidth ?? 800)) * 100;
    if (col === "en") {
      const ctrl = Math.max(15, Math.min(70, start.ctrl + dx));
      const en = Math.max(15, start.en - dx);
      store.setNlsColWidths({ ctrl, en, cn: 100 - ctrl - en > 0 ? 100 - ctrl - en : start.cn });
    } else {
      const en = Math.max(15, Math.min(70, start.en + dx));
      const cn = Math.max(15, start.cn - dx);
      store.setNlsColWidths({ en, cn, ctrl: 100 - en - cn > 0 ? 100 - en - cn : start.ctrl });
    }
  };
  const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

// ── mode ──

const editorMode = ref<EditorMode>("table");

// ── search ──

const query = ref("");

// ── tree build ──

function collectLeaves(
  node: CaaDialogNode, dialogRoot: CaaDialogNode, flat: Record<string, string>,
): { leaves: NlsTreeLeaf[]; groups: NlsTreeGroup[] } {
  const segments = nlsPathSegments(node, dialogRoot);
  const leaves: NlsTreeLeaf[] = [];
  const groups: NlsTreeGroup[] = [];

  // Title（仅适用类型）
  if (hasTitle(node.type)) {
    const titleKey = nlsKeyForProp(segments, "title");
    const titleVal = flat[titleKey] ?? "";
    leaves.push({ kind:"leaf", key:titleKey, value:titleVal, prop:"title", nodeId:node.id });
  }

  // Help/ShortHelp/LongHelp（仅适用类型，且只显示有值的）
  if (hasHelp(node.type)) {
    const h: NlsTreeLeaf[] = [];
    const addH = (p: NlsStringProp) => {
      const k = nlsKeyForProp(segments, p);
      const v = flat[k] ?? "";
      if (v.trim()) h.push({ kind:"leaf", key:k, value:v, prop:p, nodeId:node.id });
    };
    addH("help"); addH("shortHelp"); addH("longHelp");

    if (h.length > 0) {
      const allSame = h.length > 1 && new Set(h.map(l => l.value)).size === 1;
      if (allSame) {
        groups.push({ kind:"group", label:"Help / ShortHelp / LongHelp", members:h, allSameValue:true });
      } else {
        const labels: Record<string,string> = { help:"Help", shortHelp:"ShortHelp", longHelp:"LongHelp" };
        for (const leaf of h) {
          groups.push({ kind:"group", label:labels[leaf.prop]??leaf.prop, members:[leaf], allSameValue:false });
        }
      }
    }
  }

  // ColumnTitle（仅 MultiList）
  if (node.size?.columnCount || node.nls?.columnTitles?.length) {
    const cc = node.size?.columnCount ?? node.nls?.columnTitles?.length ?? 0;
    const members: NlsTreeLeaf[] = [];
    for (let i = 0; i < cc; i++) {
      const k = nlsKeyForProp(segments, "title", i);
      members.push({ kind:"leaf", key:k, value:flat[k]??"", prop:"title", nodeId:node.id, columnIndex:i });
    }
    if (members.length) groups.push({ kind:"group", label:`ColumnTitle (${members.length} 列)`, members, allSameValue:false });
  }

  return { leaves, groups };
}

function walkTree(node: CaaDialogNode, dialogRoot: CaaDialogNode, flat: Record<string,string>): NlsTreeControl[] {
  const result: NlsTreeControl[] = [];
  const { leaves, groups } = collectLeaves(node, dialogRoot, flat);
  const hasTitle = leaves.length > 0;
  if (hasTitle || groups.length > 0) {
    result.push({
      kind:"control", nodeId:node.id, nodeType:node.type,
      titleLeaf: hasTitle ? leaves[0] : undefined,
      groups,
      keyCount: (hasTitle ? 1 : 0) + groups.reduce((s,g) => s + g.members.length, 0),
    });
  }
  for (const child of node.children) {
    result.push(...walkTree(child, dialogRoot, flat));
  }
  return result;
}

const enControls = computed(() => props.root ? walkTree(props.root, props.root, props.enFlat) : []);

// ── tree-mode rows ──

interface TreeRow {
  control: NlsTreeControl;
  propLabel: string;
  leaf?: NlsTreeLeaf;
  group?: NlsTreeGroup;
  cnValue: string;
  indent: number; // 0=control header, 1=title, 2=group header, 3=group member
  isCollapsible: boolean;
  collapseKey: string;
}

const treeRows = computed((): TreeRow[] => {
  const rows: TreeRow[] = [];
  const q = query.value.trim().toLowerCase();
  for (const ctrl of enControls.value) {
    const ctrlMatch = !q || ctrl.nodeId.toLowerCase().includes(q) || ctrl.nodeType.toLowerCase().includes(q);
    let anyMatch = false;
    const subRows: TreeRow[] = [];

    // Title（仅当控件有 Title 属性）
    if (ctrl.titleLeaf) {
      const titleCn = (props.cnFlat && ctrl.titleLeaf) ? (props.cnFlat[ctrl.titleLeaf.key] ?? "") : "";
      const titleMatch = !q ||
        ctrl.titleLeaf.key.toLowerCase().includes(q) ||
        ctrl.titleLeaf.value.toLowerCase().includes(q) ||
        titleCn.toLowerCase().includes(q);
      if (ctrlMatch || titleMatch) {
        anyMatch = true;
        subRows.push({
          control: ctrl, propLabel: "Title", leaf: ctrl.titleLeaf, cnValue: titleCn,
          indent: 1, isCollapsible: false, collapseKey: "",
        });
      }
    }

    // Groups
    for (const group of ctrl.groups) {
      const groupKey = `${ctrl.nodeId}/${group.label}`;
      const groupCn = group.members[0] && props.cnFlat ? (props.cnFlat[group.members[0].key] ?? "") : "";
      const groupMatch = !q || group.members.some(m =>
        m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q) ||
        (props.cnFlat?.[m.key] ?? "").toLowerCase().includes(q)
      );

      if (ctrlMatch || groupMatch) {
        anyMatch = true;
        if (group.allSameValue && group.members.length > 1) {
          subRows.push({
            control: ctrl, propLabel: group.label, leaf: group.members[0], group, cnValue: groupCn,
            indent: 2, isCollapsible: true, collapseKey: groupKey,
          });
          if (!collapsedGroups.value.has(groupKey)) {
            for (const m of group.members) {
              subRows.push({
                control: ctrl, propLabel: m.prop === "help" ? "Help" : m.prop === "shortHelp" ? "ShortHelp" : m.prop === "longHelp" ? "LongHelp" : m.prop,
                leaf: m, cnValue: props.cnFlat?.[m.key] ?? "",
                indent: 3, isCollapsible: false, collapseKey: "",
              });
            }
          }
        } else {
          subRows.push({
            control: ctrl, propLabel: group.label, leaf: group.members[0], group, cnValue: groupCn,
            indent: 2, isCollapsible: false, collapseKey: "",
          });
        }
      }
    }

    if (ctrlMatch || anyMatch) {
      rows.push({
        control: ctrl, propLabel: "", indent: 0,
        isCollapsible: true, collapseKey: `ctrl:${ctrl.nodeId}`,
      });
      if (!collapsedControls.value.has(ctrl.nodeId)) {
        rows.push(...subRows);
      }
    }
  }
  return rows;
});

// ── table-mode rows (flat key-value, like old dialog) ──

interface TableRow { key: string; enValue: string; cnValue: string }

const tableRows = computed((): TableRow[] => {
  const q = query.value.trim().toLowerCase();
  const allKeys = new Set(Object.keys(props.enFlat));
  if (props.cnFlat) for (const k of Object.keys(props.cnFlat)) allKeys.add(k);
  return Array.from(allKeys)
    .filter(k => !q || k.toLowerCase().includes(q) || (props.enFlat[k]??"").toLowerCase().includes(q) || (props.cnFlat?.[k]??"").toLowerCase().includes(q))
    .sort((a,b) => a.localeCompare(b, undefined, { sensitivity:"base" }))
    .map(k => ({ key: k, enValue: props.enFlat[k]??"", cnValue: props.cnFlat?.[k]??"" }));
});

// ── expand/collapse ──

const collapsedControls = ref<Set<string>>(new Set());
const collapsedGroups = ref<Set<string>>(new Set());

watch(() => props.open, (on) => {
  if (!on) return;
  collapsedControls.value.clear();
  collapsedGroups.value.clear();
  for (const ctrl of enControls.value) {
    for (const g of ctrl.groups) {
      if (g.allSameValue && g.members.length > 1) {
        collapsedGroups.value.add(`${ctrl.nodeId}/${g.label}`);
      }
    }
  }
}, { immediate: true });

function toggleControl(nodeId: string) {
  const s = new Set(collapsedControls.value);
  s.has(nodeId) ? s.delete(nodeId) : s.add(nodeId);
  collapsedControls.value = s;
}
function toggleGroup(key: string) {
  const s = new Set(collapsedGroups.value);
  s.has(key) ? s.delete(key) : s.add(key);
  collapsedGroups.value = s;
}

// ── inline edit ──

const editingKey = ref<string | null>(null);
const editingLocale = ref<NlsTreeLocale>("en");
const draft = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

function isEditing(key: string, loc: NlsTreeLocale) { return editingKey.value === key && editingLocale.value === loc; }
function startEdit(key: string, value: string, loc: NlsTreeLocale) {
  editingKey.value = key; editingLocale.value = loc; draft.value = value;
  void nextTick(() => { inputRef.value?.focus(); inputRef.value?.select(); });
}
function commitEdit() {
  if (!editingKey.value) return;
  emit("update:value", editingKey.value, draft.value, editingLocale.value !== "en" ? editingLocale.value : undefined);
  editingKey.value = null;
}
function cancelEdit() { editingKey.value = null; }
function onEditKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
  else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
}
function commitGroupEdit(group: NlsTreeGroup, value: string) {
  for (const leaf of group.members) emit("update:value", leaf.key, value);
}

// ── helpers ──

function typeLabel(t: string) { return t.replace(/^CATDlg/, ""); }
const totalKeys = computed(() => enControls.value.reduce((s,c) => s + c.keyCount, 0));
const hasCn = computed(() => props.cnFlat != null && Object.keys(props.cnFlat).length > 0);
const showCn = computed(() => hasCn.value && (localeMode.value === "cn" || localeMode.value === "both"));
const showEn = computed(() => localeMode.value === "en" || localeMode.value === "both");
const title = computed(() => {
  const base = "编辑文案";
  if (localeMode.value === "both") return base + " · 中英对照";
  if (localeMode.value === "cn") return base + " · 中文";
  return base + " · 英文";
});
</script>

<template>
  <div v-if="open" class="caa-nls-panel">
    <!-- header bar -->
    <div class="caa-nls-panel-header">
      <span class="caa-nls-panel-title">{{ title }}</span>
      <button class="caa-nls-panel-close" @click="$emit('close')">✕</button>
    </div>
    <!-- toolbar -->
    <div class="caa-nls-toolbar">
      <el-input v-model="query" class="search-field" type="search" clearable size="small"
        placeholder="搜索键、值或控件名…" spellcheck="false" />
      <el-radio-group v-model="editorMode" size="small">
        <el-radio-button value="tree">树表格</el-radio-button>
        <el-radio-button value="table">平铺表</el-radio-button>
      </el-radio-group>
      <el-radio-group v-if="hasCn" v-model="localeMode" size="small">
        <el-radio-button value="en">EN</el-radio-button>
        <el-radio-button value="cn">CN</el-radio-button>
        <el-radio-button value="both">中英</el-radio-button>
      </el-radio-group>
      <el-button v-if="hasCn && localeMode === 'both'" size="small" @click="autoFill">互相填写空白</el-button>
      <el-button v-if="canCreateCn" size="small" type="primary" @click="$emit('create-cn')">添加简体中文</el-button>
      <el-button size="small" type="success" :disabled="!dirty" @click="$emit('save')">保存文案</el-button>
      <span class="caa-nls-count muted small">
        共 {{ editorMode === 'tree' ? totalKeys : tableRows.length }} 键
        <span v-if="dirty" class="caa-nls-dirty">· 有未保存修改</span>
      </span>
    </div>

    <!-- ════ 树表格模式 ════ -->
    <div v-if="editorMode === 'tree'" class="caa-nls-tree-table-wrap">
      <table class="caa-nls-tree-table">
        <thead>
          <tr>
            <th class="col-ctrl" :style="{ width: colPct.ctrl + '%' }">控件 / 属性</th>
            <th v-if="showEn" class="col-en" :style="{ width: colPct.en + '%' }">
              英文 (EN)<span class="col-resize-handle" @mousedown="onColResizeStart('en', $event)"></span>
            </th>
            <th v-if="showCn" class="col-cn" :style="{ width: colPct.cn + '%' }">
              简体中文 (CN)<span class="col-resize-handle" @mousedown="onColResizeStart('cn', $event)"></span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(row, ri) in treeRows" :key="ri">
            <!-- control header -->
            <tr v-if="row.indent === 0" class="row-ctrl-header" :data-nls-ctrl="row.control.nodeId">
              <td :colspan="(showEn ? 1 : 0) + (showCn ? 1 : 0) + 1">
                <button class="ctrl-toggle-btn" @click="toggleControl(row.control.nodeId)">
                  <span class="arrow" :class="{ expanded: !collapsedControls.has(row.control.nodeId) }">▸</span>
                  <span class="ctrl-name mono">{{ row.control.nodeId }}</span>
                  <span class="ctrl-type muted">{{ typeLabel(row.control.nodeType) }}</span>
                  <span class="ctrl-count muted">· {{ row.control.keyCount }} 键</span>
                </button>
              </td>
            </tr>
            <!-- leaf row -->
            <tr v-else class="row-leaf" :class="`indent-${row.indent}`" :data-collapse-key="row.collapseKey">
              <td class="col-ctrl">
                <span v-if="row.isCollapsible" class="arrow small" :class="{ expanded: !collapsedGroups.has(row.collapseKey) }" @click="toggleGroup(row.collapseKey)">▸</span>
                <span class="prop-label" :style="{ paddingLeft: (row.indent - 1) * 14 + 'px' }">{{ row.propLabel }}</span>
                <span v-if="row.group?.allSameValue && row.group.members.length > 1" class="group-hint">({{ row.group.members.length }} 键)</span>
              </td>
              <td v-if="showEn" class="col-en" @click="row.group?.allSameValue && row.group.members.length > 1 ? commitGroupEdit(row.group, row.leaf?.value ?? '') : startEdit(row.leaf?.key ?? '', row.leaf?.value ?? '', 'en')">
                <template v-if="!row.group?.allSameValue && row.leaf && isEditing(row.leaf.key, 'en')">
                  <input ref="inputRef" v-model="draft" class="edit-input" @keydown="onEditKeydown" @blur="commitEdit" />
                </template>
                <template v-else>
                  <span class="cell-value">
                    {{ row.leaf?.value || '' }}
                  </span>
                </template>
              </td>
              <td v-if="showCn" class="col-cn" @click="row.group?.allSameValue && row.group.members.length > 1 ? row.group.members.forEach(m => emit('update:value', m.key, row.cnValue, 'cn')) : startEdit(row.leaf?.key ?? '', row.cnValue, 'cn')">
                <template v-if="!row.group?.allSameValue && row.leaf && isEditing(row.leaf.key, 'cn')">
                  <input ref="inputRef" v-model="draft" class="edit-input" @keydown="onEditKeydown" @blur="commitEdit" />
                </template>
                <template v-else>
                  <span class="cell-value" :class="{ empty: !row.cnValue }">{{ row.cnValue || '（空）' }}</span>
                </template>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <el-empty v-if="!treeRows.length" description="无匹配项" :image-size="50" />
    </div>

    <!-- ════ 平铺表模式 ════ -->
    <div v-else class="caa-nls-flat-table-wrap">
      <table class="caa-nls-flat-table">
        <thead>
          <tr>
            <th class="col-key" :style="{ width: colPct.ctrl + '%' }">Key</th>
            <th v-if="showEn" class="col-en" :style="{ width: colPct.en + '%' }">
              英文 (EN)<span class="col-resize-handle" @mousedown="onColResizeStart('en', $event)"></span>
            </th>
            <th v-if="showCn" class="col-cn" :style="{ width: colPct.cn + '%' }">
              简体中文 (CN)<span class="col-resize-handle" @mousedown="onColResizeStart('cn', $event)"></span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in tableRows" :key="row.key">
            <td class="col-key mono small">{{ row.key }}</td>
            <td v-if="showEn" class="col-en" @click="startEdit(row.key, row.enValue, 'en')">
              <template v-if="isEditing(row.key, 'en')">
                <input ref="inputRef" v-model="draft" class="edit-input" @keydown="onEditKeydown" @blur="commitEdit" />
              </template>
              <span v-else class="cell-value">{{ row.enValue || '（空）' }}</span>
            </td>
            <td v-if="showCn" class="col-cn" @click="startEdit(row.key, row.cnValue, 'cn')">
              <template v-if="isEditing(row.key, 'cn')">
                <input ref="inputRef" v-model="draft" class="edit-input" @keydown="onEditKeydown" @blur="commitEdit" />
              </template>
              <span v-else class="cell-value" :class="{ empty: !row.cnValue }">{{ row.cnValue || '（空）' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <el-empty v-if="!tableRows.length" description="无 NLS 键" :image-size="50" />
    </div>
  </div>
</template>

<style scoped>
.caa-nls-panel {
  border: 1px solid var(--border, #e2e8f0); border-radius: 6px;
  background: #fff;
}

.caa-nls-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; background: #f8fafc;
  border-bottom: 1px solid var(--border, #e2e8f0);
}

.caa-nls-panel-title {
  font-weight: 600; font-size: 0.85rem;
}

.caa-nls-panel-close {
  border: none; background: transparent; cursor: pointer;
  font-size: 0.85rem; color: var(--muted, #94a3b8); padding: 2px 4px; border-radius: 3px;
}

.caa-nls-panel-close:hover { color: #ef4444; background: #fef2f2; }

/* toolbar */
.caa-nls-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  padding: 8px 10px;
}

/* table body */
.caa-nls-tree-table-wrap,
.caa-nls-flat-table-wrap {
  padding: 0 10px 10px;
}
.search-field { flex: 1; min-width: 140px; max-width: 280px; }
.caa-nls-count { white-space: nowrap; }
.caa-nls-dirty { color: var(--accent, #2563eb); font-weight: 600; }

/* ── shared table styles ── */
table { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 0.78rem; }
th { text-align: left; font-weight: 600; font-size: 0.72rem; color: var(--muted, #64748b); padding: 6px 8px; border-bottom: 2px solid var(--border, #e2e8f0); background: #f8fafc; position: sticky; top: 0; z-index: 1; }
td { padding: 4px 8px; border-bottom: 1px solid var(--border-light, #f1f5f9); vertical-align: baseline; }
.col-ctrl { }
.col-key { overflow: hidden; text-overflow: ellipsis; }
.col-en { position: relative; }
.col-cn { border-left: 1px solid var(--border, #e2e8f0); position: relative; }
td.col-key { white-space: nowrap; }

/* 列拖拽手柄 */
.col-resize-handle {
  position: absolute; left: -3px; top: 0; bottom: 0; width: 6px;
  cursor: col-resize; background: transparent;
}
.col-resize-handle:hover { background: var(--accent, #3b82f6); opacity: 0.3; }

/* 树表格：属性名右对齐 */
.prop-label { text-align: right; }
.row-ctrl-header td { padding: 2px 4px; background: #f8fafc; border-bottom: 1px solid var(--border, #e2e8f0); }
.ctrl-toggle-btn { display: flex; align-items: center; gap: 4px; width: 100%; border: none; background: transparent; cursor: pointer; font-size: 0.78rem; padding: 3px 4px; text-align: left; }
.ctrl-toggle-btn:hover { background: #f1f5f9; }
.ctrl-name { font-weight: 600; }
.ctrl-type { font-size: 0.68rem; }
.ctrl-count { font-size: 0.68rem; margin-left: auto; }
.arrow { display: inline-block; width: 14px; font-size: 0.65rem; color: var(--muted, #64748b); transition: transform 0.15s; cursor: pointer; flex-shrink: 0; }
.arrow.expanded { transform: rotate(90deg); }
.arrow.small { width: 12px; font-size: 0.6rem; }
.prop-label { font-weight: 500; font-size: 0.72rem; color: var(--muted, #64748b); }
.group-hint { font-size: 0.65rem; color: var(--muted, #94a3b8); margin-left: 4px; }

.cell-value { display: block; min-height: 1.3em; cursor: text; padding: 1px 4px; border-radius: 2px; word-break: break-word; }
.cell-value:hover { background: rgba(59,130,246,0.06); outline: 1px dashed rgba(59,130,246,0.3); }
.cell-value.placeholder { color: var(--muted, #94a3b8); font-style: italic; }
.cell-value.empty { color: var(--muted, #94a3b8); }

.edit-input { width: 100%; box-sizing: border-box; font: inherit; font-size: inherit; padding: 1px 4px; border: 1px solid var(--accent, #3b82f6); border-radius: 2px; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.small { font-size: 0.72rem; }
.muted { color: var(--muted, #64748b); }
</style>
