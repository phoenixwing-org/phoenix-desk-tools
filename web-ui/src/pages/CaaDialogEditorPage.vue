<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, provide, ref, toRaw, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  applyNlsPropToNode,
  applyNlsKeyToRoot,
  CAA_NLS_LOCALE_SIMPLIFIED_CHINESE,
  collectNlsFlat,
  collectNlsOrdered,
  parseCatNls,
} from "@phoenix/catdlg-core";
import PageHeader from "../components/PageHeader.vue";
import CaaDialogEditorView from "../components/caa/CaaDialogEditorView.vue";
import CaaNlsSupplementDialog from "../components/caa/CaaNlsSupplementDialog.vue";
import CaaControlContextMenu from "../components/caa/CaaControlContextMenu.vue";
import CaaDropOverlay from "../components/caa/CaaDropOverlay.vue";
import CaaNlsTreeEditor from "../components/caa/CaaNlsTreeEditor.vue";
import CaaDialogRelatedFilesTable from "../components/caa/CaaDialogRelatedFilesTable.vue";
import CaaDialogRscPreviewPanel from "../components/caa/CaaDialogRscPreviewPanel.vue";
import CaaDialogWritePreviewDialog from "../components/caa/CaaDialogWritePreviewDialog.vue";
import type { NlsSupplementDirection } from "../components/caa/CaaNlsSupplementDialog.vue";
import {
  createCaaDialogLocaleNls,
  createCaaDialogFromIr,
  deleteCaaDraft,
  fetchCaaDrafts,
  fetchCaaHealth,
  fetchCaaModuleDirs,
  parseCaaDialog,
  saveCaaDraft,
  saveCaaDialogNls,
  saveCaaDialog,
  writeCaaDialogFromIr,
  type CaaDialogGridPatch,
  type CaaDialogWriteResult,
} from "../api/caaDialog";
import { CAA_EDITOR_PAGE_ID } from "../constants/caaPages";
import { useCaaDialogPropertySheet } from "../composables/useCaaDialogPropertySheet";
import { CAA_NLS_EDIT_KEY, CAA_NLS_SESSION_KEY, type CaaNlsEditTarget } from "../composables/caaNlsEdit";
import { CAA_CONTROL_KEY, type CaaContextMenuItem } from "../composables/useCaaControlContext";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";
import { usePageSummary } from "../composables/usePageSummary";
import { useCaaDialogPageStore } from "../stores/caaDialogPage";
import type { CaaDialogIr, CaaDialogNode } from "../types/caaDialogIr";
import type { CaaDialogDraft } from "../types/caaDialogDraft";
import { dialogNameFromCatDlgRel } from "../utils/caaDialogDisplay";
import { addChildNode, collectDescendantIds, findCaaNode, insertGridCol, insertGridRow, nlsFlatMapsEqual, removeChildNode, renumberGrid } from "../utils/caaDialogTree";
import { buildBuilderRecord, type BuilderRecord } from "../utils/caaDropZone";
import { createBlankCaaDialogIr } from "../utils/createBlankCaaDialogIr";

const PAGE_ID = CAA_EDITOR_PAGE_ID;

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const store = useCaaDialogPageStore();

useCaaDialogPropertySheet(PAGE_ID, {
  onNlsChange(change) {
    if (!localIr.value) return;
    const node = findCaaNode(localIr.value.root, change.nodeId);
    if (!node) return;
    // 更新 IR 树（画布即时反映）
    applyNlsPropToNode(node, change.prop, change.value, change.columnIndex);
    if (change.nodeId === localIr.value.root.id && change.prop === "title") {
      localIr.value.title = change.value;
    }
    // 写入当前活动 locale 的 flat map
    if (nlsEditorLocale.value === "default") {
      currentNlsFlat.value = { ...currentNlsFlat.value, [change.key]: change.value };
    } else {
      const id = nlsEditorLocale.value;
      localeNlsFlats.value = {
        ...localeNlsFlats.value,
        [id]: { ...(localeNlsFlats.value[id] ?? {}), [change.key]: change.value },
      };
    }
    syncTabDirty();
    syncToSidebar();
  },
});

const workspacePath = computed(() => shell.workspacePath.value.trim());

const localIr = ref<CaaDialogIr | null>(null);
const localSelectedId = ref<string | null>(null);
const lastBuilderRecord = ref<BuilderRecord | null>(null);
const dragJustEnded = ref(false);
const parsing = ref(false);
const saving = ref(false);
const localErrorText = ref("");
const hasParsed = ref(false);
const openIsDemo = ref(false);

/** 是否为新建草稿（无磁盘文件） */
const isNewDraft = ref(false);
const draftId = ref<string | null>(null);

type CaaDialogPageSnapshot = {
  nlsFlat?: Record<string, string>;
  nlsSourceText?: string;
  localeNlsFlats?: Record<string, Record<string, string>>;
  isNewDraft?: boolean;
  draftId?: string | null;
  ir?: CaaDialogIr;
  selectedId?: string | null;
  irDirty?: boolean;
  irWriteMode?: IrWriteMode;
  editMode?: boolean;
  undoStack?: CaaIrHistoryEntry[];
  redoStack?: CaaIrHistoryEntry[];
};

type CaaNlsLocaleOption = {
  id: string;
  label: string;
  catNlsRel: string;
};

type CaaNlsTreeLocaleMode = "en" | "cn" | "both";

type IrWriteMode = "none" | "patch" | "full";

type CaaIrHistoryEntry = {
  ir: CaaDialogIr;
  selectedId: string | null;
  irWriteMode: IrWriteMode;
};

const HISTORY_LIMIT = 50;
const SESSION_HISTORY_LIMIT = 12;

/** 模块目录选择器 */
const modulePickerOpen = ref(false);
const moduleDirs = ref<string[]>([]);
const selectedModuleDir = ref("");
const newDialogName = ref("");
const loadingModuleDirs = ref(false);

const baselineNlsFlat = ref<Record<string, string>>({});
const currentNlsFlat = ref<Record<string, string>>({});
const nlsSourceText = ref("");
const nlsEditorLocale = ref("default");
const nlsTreeLocaleMode = ref<CaaNlsTreeLocaleMode>("en");
const nlsTreeEditorOpen = ref(false);
const nlsFocusNodeId = ref<string | null>(null);
const creatingChinese = ref(false);
const supplementDialogOpen = ref(false);
const supplementDirection = ref<NlsSupplementDirection>("en-to-cn");
const supplementMissingKeys = ref<string[]>([]);
const supplementing = ref(false);
const localeNlsFlats = ref<Record<string, Record<string, string>>>({});
const localeBaselineFlats = ref<Record<string, Record<string, string>>>({});
const localeSourceTexts = ref<Record<string, string>>({});

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T;
}

function irForSession(ir: CaaDialogIr): CaaDialogIr {
  const cloned = clonePlain(ir);
  if (cloned.parseMeta) {
    delete cloned.parseMeta.catNlsSourceText;
    delete cloned.parseMeta.localeNlsSourceTexts;
    cloned.parseMeta.locales = cloned.parseMeta.locales.map((locale) => {
      const copy = { ...locale };
      delete copy.sourceText;
      return copy;
    });
  }
  return cloned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCaaDialogIr(value: unknown): value is CaaDialogIr {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1 || typeof value.dialogName !== "string") return false;
  if (!isRecord(value.sources) || !isRecord(value.root)) return false;
  return typeof value.root.id === "string" && Array.isArray(value.root.children);
}

function normalizeIrWriteMode(value: unknown, fallback: IrWriteMode): IrWriteMode {
  return value === "patch" || value === "full" || value === "none" ? value : fallback;
}

function historyEntryFromSession(value: unknown): CaaIrHistoryEntry | null {
  if (!isRecord(value) || !isCaaDialogIr(value.ir)) return null;
  return {
    ir: clonePlain(value.ir),
    selectedId: typeof value.selectedId === "string" ? value.selectedId : null,
    irWriteMode: normalizeIrWriteMode(value.irWriteMode, "full"),
  };
}

function historyStackFromSession(value: unknown): CaaIrHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(historyEntryFromSession)
    .filter((entry): entry is CaaIrHistoryEntry => Boolean(entry))
    .slice(-HISTORY_LIMIT);
}

function historyStackForSession(stack: CaaIrHistoryEntry[]): CaaIrHistoryEntry[] {
  return stack.slice(-SESSION_HISTORY_LIMIT).map((entry) => ({
    ir: irForSession(entry.ir),
    selectedId: entry.selectedId ?? null,
    irWriteMode: entry.irWriteMode,
  }));
}

function stringMapFromSession(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function localeMapsFromSession(value: unknown): Record<string, Record<string, string>> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, Record<string, string>> = {};
  for (const [locale, flat] of Object.entries(value)) {
    const map = stringMapFromSession(flat);
    if (map) out[locale] = map;
  }
  return out;
}

const catDlgRel = computed(() => {
  if (!props.workbenchTabId) return "";
  return shell.getTab(props.workbenchTabId)?.contextKey?.trim() ?? "";
});

const caaEditorStoreId = computed(
  () => props.workbenchTabId?.trim() || catDlgRel.value || PAGE_ID,
);

const pageTitle = computed(() => {
  const rel = catDlgRel.value || localIr.value?.sources.catDlg?.trim() || "";
  if (rel) return dialogNameFromCatDlgRel(rel);
  return "CAA 对话框";
});

const nlsIsDirty = () => !nlsFlatMapsEqual(baselineNlsFlat.value, currentNlsFlat.value);

function nlsIsDirtyAll(): boolean {
  if (nlsIsDirty()) return true;
  for (const id of Object.keys(localeNlsFlats.value)) {
    if (
      !nlsFlatMapsEqual(
        localeBaselineFlats.value[id] ?? {},
        localeNlsFlats.value[id] ?? {},
      )
    ) {
      return true;
    }
  }
  return false;
}

const primaryCatNlsRel = computed(() => localIr.value?.sources.catNls?.trim() ?? "");

const hasChineseLocale = computed(
  () =>
    Boolean(localeNlsFlats.value[CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]) ||
    Boolean(localIr.value?.sources.nlsLocales?.[CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]),
);

const nlsLocaleOptions = computed((): CaaNlsLocaleOption[] => {
  const primary = primaryCatNlsRel.value;
  if (!primary) return [];
  const opts: CaaNlsLocaleOption[] = [
    { id: "default", label: "默认（英文）", catNlsRel: primary },
  ];
  const paths = localIr.value?.sources.nlsLocales ?? {};
  for (const [id, rel] of Object.entries(paths)) {
    if (id === "default" || rel === primary) continue;
    const label =
      id === CAA_NLS_LOCALE_SIMPLIFIED_CHINESE ? "简体中文" : id;
    opts.push({ id, label, catNlsRel: rel });
  }
  return opts;
});

const nlsKeyCountMismatch = computed<{
  en: number;
  cn: number;
  missingInCn: string[];
  missingInEn: string[];
} | null>(() => {
  if (!hasChineseLocale.value) return null;
  const enFlat = currentNlsFlat.value;
  const cnFlat = localeNlsFlats.value[CAA_NLS_LOCALE_SIMPLIFIED_CHINESE] ?? {};
  const enKeys = Object.keys(enFlat);
  const cnKeys = Object.keys(cnFlat);
  if (enKeys.length === cnKeys.length) return null;
  const cnKeySet = new Set(cnKeys);
  const enKeySet = new Set(enKeys);
  return {
    en: enKeys.length,
    cn: cnKeys.length,
    missingInCn: enKeys.filter((k) => !cnKeySet.has(k)),
    missingInEn: cnKeys.filter((k) => !enKeySet.has(k)),
  };
});

const hasNlsKeyMismatch = computed(() => nlsKeyCountMismatch.value !== null);

function setNlsFlatKey(key: string, value: string, locale?: "en" | "cn") {
  const trimmed = value.trim();
  const targetLocale = locale === "cn"
    ? CAA_NLS_LOCALE_SIMPLIFIED_CHINESE
    : locale === "en" ? "default" : nlsEditorLocale.value;

  if (targetLocale !== "default") {
    const id = targetLocale;
    localeNlsFlats.value = {
      ...localeNlsFlats.value,
      [id]: { ...(localeNlsFlats.value[id] ?? {}), [key]: trimmed },
    };
    // 如果画布正在显示此 locale，同步更新 IR 树使控件即时反映
    if (nlsEditorLocale.value === id && localIr.value) {
      applyNlsKeyToRoot(localIr.value.root, key, trimmed);
      if (key === "Title") localIr.value.title = trimmed;
      syncToSidebar();
    }
    syncTabDirty();
    return;
  }
  if (!localIr.value) return;
  currentNlsFlat.value = { ...currentNlsFlat.value, [key]: trimmed };
  applyNlsKeyToRoot(localIr.value.root, key, trimmed);
  if (key === "Title") {
    localIr.value.title = trimmed;
  }
  syncTabDirty();
  syncToSidebar();
}

function resolveLocaleIdForRel(rel: string): string {
  if (rel === primaryCatNlsRel.value) return "default";
  const map = localIr.value?.sources.nlsLocales ?? {};
  for (const [id, path] of Object.entries(map)) {
    if (path === rel) return id;
  }
  return "default";
}

function setNlsEditorLocale(locale: string, mode?: CaaNlsTreeLocaleMode) {
  nlsEditorLocale.value = locale;
  nlsTreeLocaleMode.value =
    mode ?? (locale === CAA_NLS_LOCALE_SIMPLIFIED_CHINESE ? "cn" : "en");
}

function openCatNlsEditor(repoRelPath?: string) {
  const rel = repoRelPath?.trim() || primaryCatNlsRel.value;
  if (!rel) return;
  if (openIsDemo.value) {
    ElMessage.warning("Demo 对话框不支持编辑 .CATNls");
    return;
  }
  const localeId = resolveLocaleIdForRel(rel);
  if (localeId !== "default" && !localeNlsFlats.value[localeId]) {
    ElMessage.info("请先在编辑器中「添加简体中文」或重新解析");
    return;
  }
  setNlsEditorLocale(localeId);
  setNlsFocusToSelected();
  nlsTreeEditorOpen.value = true;
}

function setNlsFocusToSelected() {
  const target = localSelectedId.value;
  nlsFocusNodeId.value = null;
  void nextTick(() => {
    nlsFocusNodeId.value = target;
  });
}

function openNlsTreeForSelectedControl() {
  if (hasChineseLocale.value && nlsEditorLocale.value === "default") {
    nlsTreeLocaleMode.value = "both";
  }
  setNlsFocusToSelected();
  nlsTreeEditorOpen.value = true;
}

/** NLS 编辑面板切换 EN/CN/中英 → 同步画布控件文本 */
function onNlsEditorLocaleChange(mode: "en" | "cn" | "both") {
  nlsTreeLocaleMode.value = mode;
  if (mode === "en") nlsEditorLocale.value = "default";
  else if (mode === "cn") nlsEditorLocale.value = CAA_NLS_LOCALE_SIMPLIFIED_CHINESE;
  // "both" 保持当前 locale 不变（仅展示双列）
}

async function createChineseLocale() {
  const ws = workspacePath.value;
  const primary = primaryCatNlsRel.value;
  const ir = localIr.value;
  if (!ws || !primary || !ir) return;
  creatingChinese.value = true;
  shell.appendLog(
    `[CAA 对话框] 创建简体中文 .CATNls → msgcatalog/${CAA_NLS_LOCALE_SIMPLIFIED_CHINESE}/…`,
    { source: PAGE_ID, open: true },
  );
  try {
    const result = await createCaaDialogLocaleNls({
      workspaceRoot: ws,
      defaultCatNlsRel: primary,
      localeDir: CAA_NLS_LOCALE_SIMPLIFIED_CHINESE,
    });
    const id = CAA_NLS_LOCALE_SIMPLIFIED_CHINESE;
    // 用英文值填充中文初始值：修改的修改，不修改的保留英文原值
    const enFlat = currentNlsFlat.value;
    const filledKeys: Record<string, string> = {};
    for (const key of Object.keys(result.nlsKeys)) {
      filledKeys[key] = enFlat[key] ?? "";
    }
    localeNlsFlats.value = { ...localeNlsFlats.value, [id]: filledKeys };
    // baseline 保持空值（磁盘状态），使填充后的值全部标记为 dirty
    localeBaselineFlats.value = { ...localeBaselineFlats.value, [id]: { ...result.nlsKeys } };
    localeSourceTexts.value = { ...localeSourceTexts.value, [id]: result.sourceText };
    if (!ir.sources.nlsLocales) ir.sources.nlsLocales = {};
    ir.sources.nlsLocales[id] = result.catNlsRel;
    if (ir.parseMeta) {
      const locales = ir.parseMeta.locales ?? [];
      if (!locales.some((l) => l.id === id)) {
        ir.parseMeta.locales = [
          ...locales,
          {
            id,
            catNlsRel: result.catNlsRel,
            keyCount: Object.keys(result.nlsKeys).length,
            sourceText: result.sourceText,
          },
        ];
      }
      ir.parseMeta.localeNlsSourceTexts = {
        ...(ir.parseMeta.localeNlsSourceTexts ?? {}),
        [id]: result.sourceText,
      };
    }
    setNlsEditorLocale(id, "cn");
    setNlsFocusToSelected();
    nlsTreeEditorOpen.value = true;
    ElMessage.success("已创建简体中文翻译文件，英文值已填入");
    shell.appendLog(`[CAA 对话框] 已创建 ${result.catNlsRel}`, { source: PAGE_ID });
    syncToSidebar();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(msg);
    shell.appendLog(`[CAA 对话框] 创建中文 NLS 失败：${msg}`, { source: PAGE_ID, open: true });
  } finally {
    creatingChinese.value = false;
  }
}

function openSupplementDialog() {
  const m = nlsKeyCountMismatch.value;
  if (!m) return;
  if (m.missingInCn.length > 0) {
    supplementDirection.value = "en-to-cn";
    supplementMissingKeys.value = m.missingInCn;
  } else {
    supplementDirection.value = "cn-to-en";
    supplementMissingKeys.value = m.missingInEn;
  }
  supplementDialogOpen.value = true;
}

function supplementNlsKeys(payload: { keys: string[]; copyValues: boolean }) {
  const ir = localIr.value;
  if (!ir) return;
  supplementing.value = true;
  try {
    if (supplementDirection.value === "en-to-cn") {
      const source = currentNlsFlat.value;
      const target = { ...(localeNlsFlats.value[CAA_NLS_LOCALE_SIMPLIFIED_CHINESE] ?? {}) };
      for (const key of payload.keys) {
        target[key] = payload.copyValues ? (source[key] ?? "") : "";
      }
      localeNlsFlats.value = {
        ...localeNlsFlats.value,
        [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: target,
      };
    } else {
      const source = localeNlsFlats.value[CAA_NLS_LOCALE_SIMPLIFIED_CHINESE] ?? {};
      const updated = { ...currentNlsFlat.value };
      for (const key of payload.keys) {
        const val = payload.copyValues ? (source[key] ?? "") : "";
        updated[key] = val;
        applyNlsKeyToRoot(ir.root, key, val);
        if (key === "Title") ir.title = val;
      }
      currentNlsFlat.value = updated;
    }
    supplementDialogOpen.value = false;
    syncTabDirty();
    syncToSidebar();
    ElMessage.success(`已补全 ${payload.keys.length} 个键`);
    shell.appendLog(
      `[CAA 对话框] 已补全 ${payload.keys.length} 个 NLS 键（${supplementDirection.value}）`,
      { source: PAGE_ID },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(msg);
  } finally {
    supplementing.value = false;
  }
}

const canCreateChinese = computed(
  () =>
    hasParsed.value &&
    !openIsDemo.value &&
    Boolean(primaryCatNlsRel.value) &&
    Boolean(workspacePath.value) &&
    !hasChineseLocale.value,
);

const canSaveNls = computed(
  () => hasParsed.value && !openIsDemo.value && Boolean(workspacePath.value),
);

const headSummary = computed(() => {
  if (!hasParsed.value || !localIr.value?.parseMeta) return "";
  const m = localIr.value.parseMeta;
  const parts = ["已解析"];
  if (m.locales.length) parts.push(`${m.locales.length} 语言 NLS`);
  if (m.rscKeyCount > 0) parts.push(`${m.rscKeyCount} 条 CATRsc`);
  if (m.bitmapFileCount > 0) parts.push(`${m.bitmapFileCount} 个位图`);
  if (nlsIsDirtyAll()) parts.push("NLS 未保存");
  return parts.join(" · ");
});

usePageSummary(headSummary);

function isActiveTab(): boolean {
  return Boolean(props.workbenchTabId && shell.activeTabId.value === props.workbenchTabId);
}

const irDirty = ref(false);
const irWriteMode = ref<IrWriteMode>("none");
const editMode = ref(true);
const undoStack = ref<CaaIrHistoryEntry[]>([]);
const redoStack = ref<CaaIrHistoryEntry[]>([]);
const writePreviewOpen = ref(false);
const writePreviewLoading = ref(false);
const writePreviewResult = ref<CaaDialogWriteResult | null>(null);
const canUndo = computed(() => undoStack.value.length > 0);
const canRedo = computed(() => redoStack.value.length > 0);
const canPreviewWrite = computed(
  () =>
    hasParsed.value &&
    !openIsDemo.value &&
    !isNewDraft.value &&
    irDirty.value &&
    irWriteMode.value === "full" &&
    Boolean(localIr.value) &&
    Boolean(catDlgRel.value) &&
    Boolean(workspacePath.value),
);

function anyDirty(): boolean {
  return isNewDraft.value || nlsIsDirtyAll() || irDirty.value;
}

function markIrDirty(mode: Exclude<IrWriteMode, "none"> = "full") {
  irDirty.value = true;
  if (mode === "full" || irWriteMode.value === "none") {
    irWriteMode.value = mode;
  }
  syncTabDirty();
}

function markIrClean() {
  irDirty.value = false;
  irWriteMode.value = "none";
  syncTabDirty();
}

function snapshotHistoryEntry(): CaaIrHistoryEntry | null {
  if (!localIr.value) return null;
  return {
    ir: clonePlain(localIr.value),
    selectedId: localSelectedId.value,
    irWriteMode: irWriteMode.value,
  };
}

function recordHistorySnapshot() {
  const entry = snapshotHistoryEntry();
  if (!entry) return;
  undoStack.value = [...undoStack.value.slice(-(HISTORY_LIMIT - 1)), entry];
  redoStack.value = [];
}

function restoreHistoryEntry(entry: CaaIrHistoryEntry) {
  localIr.value = clonePlain(entry.ir);
  localSelectedId.value = entry.selectedId ?? entry.ir.root.id;
  irWriteMode.value = entry.irWriteMode;
  irDirty.value = entry.irWriteMode !== "none";
  syncToSidebar();
  syncTabDirty();
}

function undoIrChange() {
  const previous = undoStack.value[undoStack.value.length - 1];
  const current = snapshotHistoryEntry();
  if (!previous || !current) return;
  undoStack.value = undoStack.value.slice(0, -1);
  redoStack.value = [...redoStack.value.slice(-(HISTORY_LIMIT - 1)), current];
  restoreHistoryEntry(previous);
}

function redoIrChange() {
  const next = redoStack.value[redoStack.value.length - 1];
  const current = snapshotHistoryEntry();
  if (!next || !current) return;
  redoStack.value = redoStack.value.slice(0, -1);
  undoStack.value = [...undoStack.value.slice(-(HISTORY_LIMIT - 1)), current];
  restoreHistoryEntry(next);
}

function resetHistory() {
  undoStack.value = [];
  redoStack.value = [];
}

function restoreHistoryFromSnapshot(snapshot?: CaaDialogPageSnapshot | null) {
  undoStack.value = historyStackFromSession(snapshot?.undoStack);
  redoStack.value = historyStackFromSession(snapshot?.redoStack);
}

function restoreNlsCurrentFromSnapshot(snapshot?: CaaDialogPageSnapshot | null) {
  if (!snapshot) return;
  const flat = stringMapFromSession(snapshot.nlsFlat);
  if (flat) currentNlsFlat.value = flat;
  if (typeof snapshot.nlsSourceText === "string") nlsSourceText.value = snapshot.nlsSourceText;
  const locales = localeMapsFromSession(snapshot.localeNlsFlats);
  if (locales) {
    localeNlsFlats.value = {
      ...localeNlsFlats.value,
      ...locales,
    };
  }
}

function applyCurrentNlsFlatToIr() {
  const ir = localIr.value;
  if (!ir) return;
  for (const [key, value] of Object.entries(currentNlsFlat.value)) {
    applyNlsKeyToRoot(ir.root, key, value);
    if (key === "Title") ir.title = value;
  }
}

function syncTabDirty() {
  if (!props.workbenchTabId) return;
  shell.updateTab(props.workbenchTabId, { dirty: anyDirty() });
}

function initNlsSession(ir: CaaDialogIr) {
  const source = ir.parseMeta?.catNlsSourceText ?? "";
  nlsSourceText.value = source;
  const flat = source ? parseCatNls(source) : {};
  baselineNlsFlat.value = { ...flat };
  currentNlsFlat.value = { ...flat };

  const flats: Record<string, Record<string, string>> = {};
  const baselines: Record<string, Record<string, string>> = {};
  const sources: Record<string, string> = {};
  const metaTexts = ir.parseMeta?.localeNlsSourceTexts ?? {};

  for (const loc of ir.parseMeta?.locales ?? []) {
    if (loc.id === "default") continue;
    const text = loc.sourceText ?? metaTexts[loc.id] ?? "";
    if (!text) continue;
    const parsed = parseCatNls(text);
    flats[loc.id] = { ...parsed };
    baselines[loc.id] = { ...parsed };
    sources[loc.id] = text;
  }

  if (ir.localeNls) {
    for (const [id, parsed] of Object.entries(ir.localeNls)) {
      if (!flats[id] && Object.keys(parsed).length) {
        flats[id] = { ...parsed };
        baselines[id] = { ...parsed };
      }
    }
  }

  localeNlsFlats.value = flats;
  localeBaselineFlats.value = baselines;
  localeSourceTexts.value = sources;
  setNlsEditorLocale("default", "en");
  syncTabDirty();
}

function syncToSidebar() {
  if (!isActiveTab()) return;
  store.setActiveEditor(caaEditorStoreId.value);
  store.syncEditorState(caaEditorStoreId.value, {
    ir: localIr.value,
    selectedId: localSelectedId.value,
    loading: parsing.value,
    errorText: localErrorText.value,
  });
}

function commitNlsEdit(key: string, value: string, target: CaaNlsEditTarget) {
  if (!localIr.value) return;
  const node = findCaaNode(localIr.value.root, target.nodeId);
  if (!node) return;
  // 更新 IR 树（画布即时反映）
  applyNlsPropToNode(node, target.prop, value, target.columnIndex);
  if (target.nodeId === localIr.value.root.id && target.prop === "title") {
    localIr.value.title = value;
  }
  // 写入当前活动 locale 的 flat map
  if (nlsEditorLocale.value === "default") {
    currentNlsFlat.value = { ...currentNlsFlat.value, [key]: value };
  } else {
    const id = nlsEditorLocale.value;
    localeNlsFlats.value = {
      ...localeNlsFlats.value,
      [id]: { ...(localeNlsFlats.value[id] ?? {}), [key]: value },
    };
  }
  syncTabDirty();
  syncToSidebar();
}

const dropIndicator = ref<{ rect: { left: number; top: number; width: number; height: number } | null; edge: "inside" | "right" | "bottom" | "left" | "top" }>({ rect: null, edge: "inside" });

const contextMenuVisible = ref(false);
const contextMenuItems = ref<CaaContextMenuItem[]>([]);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuTargetId = ref<string | null>(null);

function showContextMenu(nodeId: string, items: CaaContextMenuItem[], pos: { x: number; y: number }) {
  contextMenuTargetId.value = nodeId;
  contextMenuItems.value = items;
  contextMenuPosition.value = pos;
  contextMenuVisible.value = true;
}

function hideContextMenu() {
  contextMenuVisible.value = false;
  contextMenuTargetId.value = null;
}

function toggleGridRowResize(containerId: string, rowIndex: number) {
  const root = localIr.value?.root;
  if (!root) return;
  const node = findCaaNode(root, containerId);
  if (!node) return;
  recordHistorySnapshot();
  const gl = node.gridLayout ?? {};
  const cur = [...(gl.rowResizable ?? [])];
  const idx = cur.indexOf(rowIndex);
  if (idx >= 0) cur.splice(idx, 1);
  else cur.push(rowIndex);
  cur.sort((a, b) => a - b);
  node.gridLayout = { ...gl, rowResizable: cur };
  markIrDirty("patch");
  syncToSidebar();
}

function toggleGridColResize(containerId: string, colIndex: number) {
  const root = localIr.value?.root;
  if (!root) return;
  const node = findCaaNode(root, containerId);
  if (!node) return;
  recordHistorySnapshot();
  const gl = node.gridLayout ?? {};
  const cur = [...(gl.colResizable ?? [])];
  const idx = cur.indexOf(colIndex);
  if (idx >= 0) cur.splice(idx, 1);
  else cur.push(colIndex);
  cur.sort((a, b) => a - b);
  node.gridLayout = { ...gl, colResizable: cur };
  markIrDirty("patch");
  syncToSidebar();
}

function setGridRowResize(
  containerId: string,
  rowIndex: number,
  enabled: boolean,
  opts?: { recordHistory?: boolean },
) {
  const root = localIr.value?.root;
  if (!root) return;
  const node = findCaaNode(root, containerId);
  if (!node) return;
  const gl = node.gridLayout ?? {};
  const cur = [...(gl.rowResizable ?? [])];
  const idx = cur.indexOf(rowIndex);
  const hasValue = idx >= 0;
  if (hasValue === enabled) return;
  if (opts?.recordHistory !== false) recordHistorySnapshot();
  if (enabled) cur.push(rowIndex);
  else cur.splice(idx, 1);
  cur.sort((a, b) => a - b);
  node.gridLayout = { ...gl, rowResizable: cur };
  markIrDirty("patch");
  syncToSidebar();
}

function setGridColResize(
  containerId: string,
  colIndex: number,
  enabled: boolean,
  opts?: { recordHistory?: boolean },
) {
  const root = localIr.value?.root;
  if (!root) return;
  const node = findCaaNode(root, containerId);
  if (!node) return;
  const gl = node.gridLayout ?? {};
  const cur = [...(gl.colResizable ?? [])];
  const idx = cur.indexOf(colIndex);
  const hasValue = idx >= 0;
  if (hasValue === enabled) return;
  if (opts?.recordHistory !== false) recordHistorySnapshot();
  if (enabled) cur.push(colIndex);
  else cur.splice(idx, 1);
  cur.sort((a, b) => a - b);
  node.gridLayout = { ...gl, colResizable: cur };
  markIrDirty("patch");
  syncToSidebar();
}

const canEditNls = computed(
  () => hasParsed.value && !openIsDemo.value && Boolean(localIr.value?.sources.catNls),
);

function handleControlSelect(nodeId: string) {
  localSelectedId.value = nodeId;
  store.setSelectedId(nodeId, caaEditorStoreId.value);
}

function removeControlFromContainer(containerId: string, nodeId: string): boolean {
  const root = localIr.value?.root;
  if (!root || nodeId === root.id) return false;
  const container = findCaaNode(root, containerId);
  if (!container) return false;
  const nextChildren = container.children.filter((c) => c.id !== nodeId);
  if (nextChildren.length === container.children.length) return false;
  recordHistorySnapshot();
  container.children = nextChildren;
  renumberGrid(container);
  if (localSelectedId.value === nodeId) {
    localSelectedId.value = containerId;
    store.setSelectedId(containerId, caaEditorStoreId.value);
  }
  markIrDirty("full");
  syncToSidebar();
  return true;
}

function deleteSelectedControl(): boolean {
  const root = localIr.value?.root;
  const selectedId = localSelectedId.value;
  if (!root || !selectedId || selectedId === root.id) return false;
  const selectedNode = findCaaNode(root, selectedId);
  const parentId = selectedNode?.father;
  if (!parentId) return false;
  return removeControlFromContainer(parentId, selectedId);
}

/** 从 model 树重新计算 NLS 扁平表，去除残留 + 按 model 顺序排列 */
function syncNlsFromModel() {
  const root = localIr.value?.root;
  if (!root) return;
  const modelNls = collectNlsFlat(root);
  // 合并：用户手动编辑的值覆盖 model 默认值
  const merged: Record<string, string> = { ...modelNls };
  for (const [key, value] of Object.entries(currentNlsFlat.value)) {
    if (key in merged) merged[key] = value;
  }
  currentNlsFlat.value = merged;
}

/** Builder 删除实现：从容器中移除控件，记录 BuilderRecord */
function removeControlImpl(containerId: string, nodeId: string) {
  const root = localIr.value?.root;
  if (!root) return;
  const container = findCaaNode(root, containerId);
  if (!container) return;

  // 快照（仅第一层，含容器子树引用）
  const childrenBefore = container.children.map((c) => ({
    ...c,
    grid: c.grid ? { ...c.grid } : undefined,
    children: c.children,
  }));

  // 使用纯函数移除
  const { removed, newChildren } = removeChildNode(container.children, nodeId);
  container.children = newChildren;
  renumberGrid(container);
  markIrDirty();
  syncToSidebar();

  // 记录 BuilderRecord
  if (removed) {
    const descIds = collectDescendantIds(removed);
    console.log("[CAA delete] Record: removed=%s type=%s descendants=%d",
      removed.id, removed.type, descIds.length);
    lastBuilderRecord.value = buildBuilderRecord({
      operation: "DELETE",
      sourceContainerId: null,
      targetContainerId: containerId,
      sourceChildrenBefore: null,
      targetChildrenBefore: childrenBefore,
      targetChildrenAfter: container.children.map((c) => ({ ...c, grid: c.grid ? { ...c.grid } : undefined, children: c.children })),
      sourceChildrenAfter: null,
      affectedNodeId: nodeId,
      affectedNodeType: removed.type,
    });
  }

  // 同步 NLS：去除被删控件的残留 key
  syncNlsFromModel();
}

provide(CAA_CONTROL_KEY, {
  get dialogRoot() { return localIr.value?.root ?? null; },
  selectedId: localSelectedId,
  select: handleControlSelect,
  canEdit: canEditNls,
  activeLocale: nlsEditorLocale,
  commitNls: commitNlsEdit,
  showContextMenu,
  hideContextMenu,
  contextMenuVisible,
  contextMenuItems,
  contextMenuPosition,
  contextMenuTargetId,
  toggleGridRowResize,
  toggleGridColResize,
  setGridRowResize,
  setGridColResize,
  editMode,
  // ── Builder drop indicator ──
  dropIndicator,
  // ── Builder ──
  addControl(containerId: string, typeOrNodeId: string, row: number, col: number) {
    const root = localIr.value?.root;
    if (!root) return "";
    const container = findCaaNode(root, containerId);
    if (!container) return "";
    recordHistorySnapshot();
    // 如果是已存在的节点 ID（跨容器移动），直接复用
    const existing = findCaaNode(root, typeOrNodeId);
    if (existing) {
      existing.grid = { row, col, rowSpan: 1, colSpan: 1 };
      existing.father = containerId;
      container.children.push(existing);
    } else {
      addChildNode(container, typeOrNodeId, { row, col });
    }
    renumberGrid(container);
    markIrDirty("full");
    syncToSidebar();
    syncNlsFromModel();
    return typeOrNodeId;
  },
  removeControl(containerId: string, nodeId: string) {
    removeControlImpl(containerId, nodeId);
  },
  insertRow(containerId: string, beforeRow: number) {
    const root = localIr.value?.root;
    if (!root) return;
    const container = findCaaNode(root, containerId);
    if (!container) return;
    recordHistorySnapshot();
    insertGridRow(container, beforeRow);
    renumberGrid(container);
    markIrDirty("full");
    syncToSidebar();
  },
  insertCol(containerId: string, beforeCol: number) {
    const root = localIr.value?.root;
    if (!root) return;
    const container = findCaaNode(root, containerId);
    if (!container) return;
    recordHistorySnapshot();
    insertGridCol(container, beforeCol);
    renumberGrid(container);
    markIrDirty("full");
    syncToSidebar();
  },
  recordHistory: recordHistorySnapshot,
  // ── 原子替换子节点（MVC：计算→apply 一次完成）──
  setChildren(containerId: string, children: CaaDialogNode[], selectId?: string) {
    const root = localIr.value?.root;
    if (!root) return;
    const container = findCaaNode(root, containerId);
    if (!container) return;
    container.children = children;
    renumberGrid(container);
    if (selectId) localSelectedId.value = selectId;
    markIrDirty("full");
    syncToSidebar();
  },
  // ── Builder 操作记录 ──
  lastBuilderRecord,
  // ── 拖拽后抑制 click ──
  dragJustEnded,
});

const nlsEditCtx = {
  enabled: computed(
    () => hasParsed.value && !openIsDemo.value && Boolean(localIr.value?.sources.catNls),
  ),
  commit: commitNlsEdit,
};
provide(CAA_NLS_EDIT_KEY, nlsEditCtx);

provide(CAA_NLS_SESSION_KEY, {
  canEdit: computed(
    () => hasParsed.value && !openIsDemo.value && Boolean(localIr.value?.sources.catNls),
  ),
  primaryCatNlsRel,
  isDirty: computed(() => nlsIsDirtyAll()),
  openCatNlsEditor,
  hasChineseLocale,
  createChineseLocale,
});

async function checkHealth() {
  try {
    store.setCaaHealth(await fetchCaaHealth(), true);
  } catch {
    store.setCaaHealth(null, false);
  }
}

function resolveOpenTarget(): { catDlgRel: string; isDemo: boolean; isNewDraft?: boolean; draftId?: string } | null {
  if (!props.workbenchTabId) return null;
  const payload = shell.consumeTabPayload(props.workbenchTabId);
  const fromPayload = payload?.caaDialog;
  if (fromPayload?.isNewDraft && fromPayload?.draftId?.trim()) {
    return { catDlgRel: "", isDemo: false, isNewDraft: true, draftId: fromPayload.draftId.trim() };
  }
  if (fromPayload?.catDlgRel?.trim()) {
    return { catDlgRel: fromPayload.catDlgRel.trim(), isDemo: Boolean(fromPayload.isDemo) };
  }
  // 会话恢复：payload 已被消费，从 contextKey 判断
  const rel = catDlgRel.value;
  if (rel?.startsWith("draft:")) {
    return { catDlgRel: "", isDemo: false, isNewDraft: true, draftId: rel.slice(6) };
  }
  if (rel) return { catDlgRel: rel, isDemo: false };
  return null;
}

function hydrateDraftSnapshot(snapshot?: Record<string, unknown>): boolean {
  const state = snapshot as CaaDialogPageSnapshot | undefined;
  if (!state?.isNewDraft || !isCaaDialogIr(state.ir)) return false;

  isNewDraft.value = true;
  draftId.value = state.draftId?.trim() || draftId.value;
  localIr.value = clonePlain(state.ir);
  currentNlsFlat.value = stringMapFromSession(state.nlsFlat) ?? {};
  baselineNlsFlat.value = { ...currentNlsFlat.value };
  nlsSourceText.value = state.nlsSourceText ?? "";
  localeNlsFlats.value = localeMapsFromSession(state.localeNlsFlats) ?? {};
  localeBaselineFlats.value = clonePlain(localeNlsFlats.value);
  applyCurrentNlsFlatToIr();
  localSelectedId.value = state.selectedId?.trim() || state.ir.root.id;
  irDirty.value = state.irDirty ?? true;
  irWriteMode.value = normalizeIrWriteMode(state.irWriteMode, irDirty.value ? "full" : "none");
  editMode.value = state.editMode ?? true;
  restoreHistoryFromSnapshot(state);
  hasParsed.value = true;
  openIsDemo.value = false;

  if (props.workbenchTabId) {
    shell.updateTab(props.workbenchTabId, {
      title: state.ir.dialogName || "NewDlg",
      subtitle: "未保存",
      dirty: anyDirty(),
    });
  }
  syncToSidebar();
  syncTabDirty();
  return true;
}

async function parseDialog() {
  const pageState = props.workbenchTabId
    ? shell.consumeTabPageState(props.workbenchTabId)
    : undefined;
  const restoredState = pageState as CaaDialogPageSnapshot | undefined;
  if (hydrateDraftSnapshot(pageState)) return;

  const target = resolveOpenTarget();
  if (!target) {
    localErrorText.value = "未指定 .CATDlg 路径";
    localIr.value = null;
    localSelectedId.value = null;
    hasParsed.value = false;
    syncToSidebar();
    return;
  }

  // ── 新建草稿：从 API 加载 IR ──
  if (target.isNewDraft && target.draftId) {
    isNewDraft.value = true;
    draftId.value = target.draftId;
    parsing.value = true;
    localErrorText.value = "";
    try {
      const ws = workspacePath.value;
      if (ws) {
        const { drafts } = await fetchCaaDrafts(ws);
        const found = drafts.find((d: Record<string, unknown>) => d.id === target.draftId);
        if (found) {
          localIr.value = found.ir as CaaDialogIr;
          currentNlsFlat.value = (found.nlsFlat as Record<string, string>) ?? {};
          baselineNlsFlat.value = { ...currentNlsFlat.value };
        } else {
          // 草稿丢失，用空白 IR
          localIr.value = createBlankCaaDialogIr(target.draftId === "" ? "NewDlg" : "NewDlg");
          currentNlsFlat.value = {};
          baselineNlsFlat.value = {};
        }
      } else {
        localIr.value = createBlankCaaDialogIr();
        currentNlsFlat.value = {};
        baselineNlsFlat.value = {};
      }
      restoreNlsCurrentFromSnapshot(restoredState);
      applyCurrentNlsFlatToIr();
      localSelectedId.value = restoredState?.selectedId?.trim() || localIr.value?.dialogName || null;
      editMode.value = restoredState?.editMode ?? true;
      irDirty.value = restoredState?.irDirty ?? true;
      irWriteMode.value = normalizeIrWriteMode(restoredState?.irWriteMode, irDirty.value ? "full" : "none");
      restoreHistoryFromSnapshot(restoredState);
      hasParsed.value = true;
      openIsDemo.value = false;
      if (props.workbenchTabId) {
        shell.updateTab(props.workbenchTabId, {
          title: localIr.value?.dialogName ?? "NewDlg",
          subtitle: "未保存",
          dirty: true,
        });
      }
    } catch (e) {
      localErrorText.value = e instanceof Error ? e.message : String(e);
    } finally {
      parsing.value = false;
      syncToSidebar();
    }
    return;
  }

  openIsDemo.value = target.isDemo;
  syncToSidebar();
  shell.appendLog(`[CAA 对话框] 解析 ${target.catDlgRel}…`, { source: PAGE_ID, open: true });
  try {
    const ir = await parseCaaDialog(
      target.isDemo
        ? { demo: true, workspaceRoot: "", catDlgRel: target.catDlgRel }
        : { workspaceRoot: workspacePath.value, catDlgRel: target.catDlgRel },
    );
    const restoredIr = isCaaDialogIr(restoredState?.ir) ? restoredState.ir : null;
    const restoreDirtyIr = Boolean(restoredState?.irDirty && restoredIr);
    initNlsSession(ir);
    restoreNlsCurrentFromSnapshot(restoredState);
    localIr.value = restoreDirtyIr && restoredIr ? clonePlain(restoredIr) : ir;
    applyCurrentNlsFlatToIr();
    localSelectedId.value = restoredState?.selectedId?.trim() || localIr.value.dialogName;
    editMode.value = restoredState?.editMode ?? true;
    if (restoreDirtyIr) {
      irDirty.value = true;
      irWriteMode.value = normalizeIrWriteMode(restoredState?.irWriteMode, "full");
      syncTabDirty();
    } else {
      markIrClean();
    }
    restoreHistoryFromSnapshot(restoredState);
    hasParsed.value = true;
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, {
        title: dialogNameFromCatDlgRel(target.catDlgRel),
        subtitle: target.catDlgRel.split("/").pop() ?? `${ir.dialogName}.CATDlg`,
        dirty: anyDirty(),
      });
    }
    const meta = ir.parseMeta;
    const localeNote = meta?.locales.length ? ` · ${meta.locales.length} 语言 NLS` : "";
    const rscNote = meta?.rscKeyCount ? ` · ${meta.rscKeyCount} 条 CATRsc` : "";
    shell.appendLog(`[CAA 对话框] 解析完成${localeNote}${rscNote}`, { source: PAGE_ID });
    if (meta?.resolvedAbs) {
      const abs = meta.resolvedAbs;
      if (abs.workspaceRoot) {
        shell.appendLog(`[CAA 对话框] 工作空间根 → ${abs.workspaceRoot}`, { source: PAGE_ID });
      }
      if (abs.catDlg) shell.appendLog(`[CAA 对话框] .CATDlg → ${abs.catDlg}`, { source: PAGE_ID });
      if (abs.catNls) shell.appendLog(`[CAA 对话框] .CATNls → ${abs.catNls}`, { source: PAGE_ID });
      else shell.appendLog("[CAA 对话框] .CATNls 未解析到磁盘文件", { source: PAGE_ID });
      if (abs.msgCatalogDir) {
        shell.appendLog(`[CAA 对话框] msgcatalog → ${abs.msgCatalogDir}`, { source: PAGE_ID });
      }
    }
    if (meta?.logs?.length) {
      for (const line of meta.logs) {
        shell.appendLog(`[CAA 对话框] ${line}`, { source: PAGE_ID });
      }
    }
    if (meta?.warnings.length) {
      for (const w of meta.warnings) {
        shell.appendLog(`[CAA 对话框] 警告：${w}`, { source: PAGE_ID });
      }
    }
  } catch (e) {
    localErrorText.value = e instanceof Error ? e.message : String(e);
    shell.appendLog(`[CAA 对话框] 解析失败：${localErrorText.value}`, { source: PAGE_ID, open: true });
    localIr.value = null;
    localSelectedId.value = null;
    hasParsed.value = false;
  } finally {
    parsing.value = false;
    syncToSidebar();
  }
}

// ── 开发用：最小测试 IR（只有 Group + MultiList + Button）──

function loadTestDlg() {
  const root: CaaDialogNode = {
    id: "TestDlg",
    type: "CATDlgDialog",
    style: ["CATDlgWndBtn"],
    gridLayout: { rowResizable: [0], colResizable: [0] },
    children: [
      {
        id: "FrameGroup",
        type: "CATDlgFrame",
        grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        gridLayout: { rowResizable: [0], colResizable: [0] },
        nls: { title: " Test Group " },
        children: [
          {
            id: "MultiListInGroup",
            type: "CATDlgMultiList",
            grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
            size: { textHeight: 5, textWidth: 20, columnCount: 3 },
            nls: { title: "表格", columnTitles: ["A", "B", "C"] },
            children: [],
          },
          {
            id: "BtnInGroup",
            type: "CATDlgPushButton",
            grid: { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
            nls: { title: "Test Button" },
            children: [],
          },
        ],
      },
    ],
  };

  localIr.value = {
    schemaVersion: 1,
    dialogName: "TestDlg",
    title: "Test Group Dialog",
    root,
    sources: { catDlg: "__test__/TestDlg.CATDlg" },
  };
  localSelectedId.value = "TestDlg";
  hasParsed.value = true;
  openIsDemo.value = false;
  syncToSidebar();
  ElMessage.success("已加载测试 DLG（Group + MultiList + Button）");
}

/** 收集 IR 中所有容器的 gridLayout → patch 列表 */
function collectGridPatches(): CaaDialogGridPatch[] {
  const patches: CaaDialogGridPatch[] = [];
  function walk(n: CaaDialogNode) {
    if (n.gridLayout) {
      patches.push({
        nodeId: n.id,
        rowResizable: n.gridLayout.rowResizable,
        colResizable: n.gridLayout.colResizable,
      });
    }
    for (const c of n.children) walk(c);
  }
  if (localIr.value?.root) walk(localIr.value.root);
  return patches;
}

async function previewWriteback() {
  const ir = localIr.value;
  const rel = catDlgRel.value;
  const ws = workspacePath.value;
  if (!ir || !rel || !ws) {
    ElMessage.warning("无法预览写回：缺少工作空间或 .CATDlg");
    return;
  }
  writePreviewOpen.value = true;
  writePreviewLoading.value = true;
  writePreviewResult.value = null;
  try {
    const result = await writeCaaDialogFromIr({
      workspaceRoot: ws,
      catDlgRel: rel,
      ir: clonePlain(ir) as unknown as Record<string, unknown>,
      dryRun: true,
    });
    writePreviewResult.value = result;
    if (!result.changed.catDlg) {
      ElMessage.info(".CATDlg 与当前 IR 生成结果一致");
    }
    if (result.validation?.warnings?.length) {
      for (const w of result.validation.warnings) {
        shell.appendLog(`[CAA 对话框] 写回预览警告：${w}`, { source: PAGE_ID });
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(`写回预览失败：${msg}`);
    shell.appendLog(`[CAA 对话框] 写回预览失败：${msg}`, { source: PAGE_ID, open: true });
  } finally {
    writePreviewLoading.value = false;
  }
}

async function confirmWritePreview() {
  writePreviewOpen.value = false;
  await saveNls({ gridSave: true });
}

async function saveNls(opts?: { gridSave?: boolean }) {
  const doGridSave = opts?.gridSave !== false;
  const ir = localIr.value;
  const catNlsRel = ir?.sources.catNls?.trim();
  const catDlgRel = ir?.sources.catDlg?.trim();
  const ws = workspacePath.value;
  if (!ir || !ws) {
    ElMessage.warning("无法保存：缺少工作空间");
    return;
  }
  if (openIsDemo.value) {
    ElMessage.warning("Demo 对话框不支持保存到磁盘");
    return;
  }
  saving.value = true;
  let savedCount = 0;
  try {
    // 保存前从 model 同步 NLS：去除已删除控件的残留 key
    syncNlsFromModel();

    // 用 model 树 DFS grid 排序生成有序 entries
    const ordered = collectNlsOrdered(ir.root);

    if (nlsIsDirty()) {
      if (!catNlsRel) {
        ElMessage.warning("无法保存：缺少 .CATNls 路径");
        return;
      }
      const entries = ordered.map((e) => ({
        key: e.key,
        value: currentNlsFlat.value[e.key] ?? e.value,
      }));

      shell.appendLog(`[CAA 对话框] 保存 .CATNls → ${catNlsRel}`, { source: PAGE_ID, open: true });
      const result = await saveCaaDialogNls({
        workspaceRoot: ws,
        catNlsRel,
        entries,
        sourceText: nlsSourceText.value,
      });
      nlsSourceText.value = result.sourceText;
      if (ir.parseMeta) ir.parseMeta.catNlsSourceText = result.sourceText;
      baselineNlsFlat.value = { ...currentNlsFlat.value };
      shell.appendLog(`[CAA 对话框] 已写入 ${result.absPath}`, { source: PAGE_ID });
      savedCount++;
    }

    const nlsLocales = ir.sources.nlsLocales ?? {};
    for (const [localeId, rel] of Object.entries(nlsLocales)) {
      if (!rel || rel === catNlsRel) continue;
      const flat = localeNlsFlats.value[localeId];
      const baseline = localeBaselineFlats.value[localeId] ?? {};
      if (!flat || nlsFlatMapsEqual(baseline, flat)) continue;
      // locale 也用 model 排序
      const localeEntries = ordered.map((e) => ({
        key: e.key,
        value: flat[e.key] ?? "",
      }));
      shell.appendLog(`[CAA 对话框] 保存 .CATNls → ${rel}`, { source: PAGE_ID, open: true });
      const result = await saveCaaDialogNls({
        workspaceRoot: ws,
        catNlsRel: rel,
        entries: localeEntries,
        sourceText: localeSourceTexts.value[localeId] ?? "",
      });
      localeSourceTexts.value = { ...localeSourceTexts.value, [localeId]: result.sourceText };
      localeBaselineFlats.value = { ...localeBaselineFlats.value, [localeId]: { ...flat } };
      if (ir.parseMeta) {
        const locales = ir.parseMeta.locales ?? [];
        const idx = locales.findIndex((l) => l.id === localeId);
        if (idx >= 0) {
          locales[idx] = { ...locales[idx], sourceText: result.sourceText };
        }
        ir.parseMeta.localeNlsSourceTexts = {
          ...(ir.parseMeta.localeNlsSourceTexts ?? {}),
          [localeId]: result.sourceText,
        };
      }
      shell.appendLog(`[CAA 对话框] 已写入 ${result.absPath}`, { source: PAGE_ID });
      savedCount++;
    }

    syncTabDirty();
    if (savedCount > 0) {
      ElMessage.success(`已保存 ${savedCount} 个 .CATNls`);
    }

    // Grid 布局写回 .CATDlg（model → 文件完整 emit）
    if (doGridSave && irDirty.value && catDlgRel) {
      try {
        if (irWriteMode.value === "full") {
          const result = await writeCaaDialogFromIr({
            workspaceRoot: ws,
            catDlgRel,
            ir: clonePlain(ir) as unknown as Record<string, unknown>,
          });
          shell.appendLog(`[CAA 对话框] .CATDlg 已写入 ${result.absPath}`, { source: PAGE_ID });
          if (result.changed.header && result.headerRel) {
            shell.appendLog(`[CAA 对话框] Wizard .h 声明段已同步 → ${result.headerRel}`, { source: PAGE_ID });
          }
          if (result.changed.cpp && result.cppRel) {
            shell.appendLog(`[CAA 对话框] Wizard .cpp 构造段已同步 → ${result.cppRel}`, { source: PAGE_ID });
          }
          if (result.validation?.warnings?.length) {
            for (const w of result.validation.warnings) {
              shell.appendLog(`[CAA 对话框] 写回警告：${w}`, { source: PAGE_ID });
            }
          }
          markIrClean();
          savedCount++;
        } else {
          const patches = collectGridPatches();
          if (patches.length > 0) {
            const result = await saveCaaDialog({ workspaceRoot: ws, catDlgRel, patches });
            shell.appendLog(`[CAA 对话框] Grid 布局已写入 ${result.absPath}`, { source: PAGE_ID });
            markIrClean();
            savedCount++;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        shell.appendLog(`[CAA 对话框] .CATDlg 写回失败：${msg}`, { source: PAGE_ID, open: true });
        ElMessage.error(`.CATDlg 写回失败：${msg}`);
      }
    }

    if (savedCount === 0) {
      ElMessage.info("没有需要保存的修改");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(msg);
    shell.appendLog(`[CAA 对话框] 保存失败：${msg}`, { source: PAGE_ID, open: true });
  } finally {
    saving.value = false;
  }
}

/** 打开模块目录选择器 */
async function openModulePicker() {
  const ws = workspacePath.value;
  if (!ws) { ElMessage.warning("请先选择工作空间"); return; }
  modulePickerOpen.value = true;
  newDialogName.value = localIr.value?.dialogName || "NewDlg";
  selectedModuleDir.value = "";
  if (!moduleDirs.value.length) {
    loadingModuleDirs.value = true;
    try {
      const { dirs } = await fetchCaaModuleDirs(ws);
      moduleDirs.value = dirs;
    } catch { moduleDirs.value = []; }
    finally { loadingModuleDirs.value = false; }
  }
}

function cloneIrForCreate(ir: CaaDialogIr, dialogName: string): CaaDialogIr {
  const cloned = clonePlain(ir);
  const oldRootId = cloned.root.id;
  cloned.dialogName = dialogName;
  cloned.title = dialogName;
  cloned.root.id = dialogName;
  function walk(node: CaaDialogNode, parentId?: string) {
    if (parentId) node.father = parentId;
    else delete node.father;
    if (node.father === oldRootId) node.father = dialogName;
    for (const child of node.children) walk(child, node.id);
  }
  walk(cloned.root);
  return cloned;
}

function buildDraftPayload(): CaaDialogDraft | null {
  if (!isNewDraft.value || !draftId.value || !localIr.value) return null;
  const now = new Date().toISOString();
  return {
    id: draftId.value,
    dialogName: localIr.value.dialogName || "NewDlg",
    ir: clonePlain(localIr.value),
    nlsFlat: { ...currentNlsFlat.value },
    createdAt: now,
    updatedAt: now,
  };
}

async function flushDraft(): Promise<boolean> {
  const ws = workspacePath.value;
  const draft = buildDraftPayload();
  if (!ws || !draft) return true;
  try {
    await saveCaaDraft(ws, draft as unknown as Record<string, unknown>);
    markIrClean();
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(msg);
    return false;
  }
}

/** 新建对话框：将 IR 写入磁盘 */
async function saveDialogToDisk() {
  const ir = localIr.value;
  const ws = workspacePath.value;
  const dir = selectedModuleDir.value.trim();
  const name = newDialogName.value.trim();
  if (!ir || !ws || !dir || !name) {
    ElMessage.warning("请选择模块目录并输入对话框名称");
    return;
  }
  modulePickerOpen.value = false;
  saving.value = true;
  try {
    const irToCreate = cloneIrForCreate(ir, name);
    const result = await createCaaDialogFromIr({
      workspaceRoot: ws,
      targetDirRel: dir,
      dialogName: name,
      ir: irToCreate as unknown as Record<string, unknown>,
    });
    irToCreate.sources.catDlg = result.catDlgRel;
    irToCreate.sources.catNls = result.catNlsRel;
    localIr.value = irToCreate;
    isNewDraft.value = false;
    markIrClean();
    baselineNlsFlat.value = { ...currentNlsFlat.value };
    localeBaselineFlats.value = clonePlain(localeNlsFlats.value);
    if (draftId.value) {
      deleteCaaDraft(ws, draftId.value).catch(() => {});
    }
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, {
        title: irToCreate.dialogName,
        subtitle: result.catDlgRel.split("/").pop() ?? "",
        dirty: false,
      });
      // 更新 contextKey 为真实路径
      const tab = shell.getTab(props.workbenchTabId);
      if (tab) tab.contextKey = result.catDlgRel;
    }
    ElMessage.success(`已创建 ${result.catDlgRel}`);
    shell.appendLog(`[CAA 对话框] 已创建 ${result.catDlgRel}`, { source: PAGE_ID });
    resetHistory();
    syncToSidebar();
    syncTabDirty();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(msg);
  } finally {
    saving.value = false;
  }
}

usePageSession(props.workbenchTabId, {
  serialize: () => {
    const snapshot: CaaDialogPageSnapshot = {
      nlsFlat: { ...currentNlsFlat.value },
      nlsSourceText: nlsSourceText.value,
      localeNlsFlats: clonePlain(localeNlsFlats.value),
      selectedId: localSelectedId.value,
      irDirty: irDirty.value,
      irWriteMode: irWriteMode.value,
      editMode: editMode.value,
    };
    const undoHistory = historyStackForSession(undoStack.value);
    const redoHistory = historyStackForSession(redoStack.value);
    if (undoHistory.length) snapshot.undoStack = undoHistory;
    if (redoHistory.length) snapshot.redoStack = redoHistory;
    if (isNewDraft.value && localIr.value) {
      snapshot.isNewDraft = true;
      snapshot.draftId = draftId.value;
      snapshot.ir = irForSession(localIr.value);
    } else if (irDirty.value && localIr.value) {
      snapshot.ir = irForSession(localIr.value);
    }
    return snapshot as Record<string, unknown>;
  },
  hydrate: async () => false,
  isDirty: anyDirty,
  flush: async () => {
    if (isNewDraft.value) return flushDraft();
    if (!anyDirty()) return true;
    await saveNls({ gridSave: true });
    return !anyDirty();
  },
});

/** 切换语言时把对应 locale 的 NLS 值写入 IR 树，画布即时切换 */
watch(nlsEditorLocale, (locale) => {
  const ir = localIr.value;
  if (!ir) return;
  const flat =
    locale === "default"
      ? currentNlsFlat.value
      : (localeNlsFlats.value[locale] ?? {});
  for (const [key, value] of Object.entries(flat)) {
    applyNlsKeyToRoot(ir.root, key, value);
    if (key === "Title") ir.title = value || undefined;
  }
  syncToSidebar();
});

watch([localIr, localSelectedId, parsing, localErrorText], syncToSidebar);

watch(
  () => store.selectedId,
  (id) => {
    if (isActiveTab() && id !== localSelectedId.value) {
      localSelectedId.value = id;
    }
  },
);

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

function onWindowKeydown(e: KeyboardEvent) {
  if (!isActiveTab() || isEditableEventTarget(e.target)) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "z") {
    e.preventDefault();
    if (e.shiftKey) redoIrChange();
    else undoIrChange();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === "y") {
    e.preventDefault();
    redoIrChange();
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && (key === "delete" || key === "backspace")) {
    if (deleteSelectedControl()) e.preventDefault();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown);
  void checkHealth();
  void parseDialog();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown);
  store.clearEditor(caaEditorStoreId.value);
});

onActivated(() => {
  store.setActiveEditor(caaEditorStoreId.value);
  syncToSidebar();
});
</script>

<template>
  <div class="page tool-page caa-dialog-page">
    <PageHeader :title="pageTitle" :page-id="PAGE_ID">
      <template #actions>
        <div class="head-actions-inner">
          <el-button
            v-if="hasParsed"
            size="small"
            :type="editMode ? 'primary' : 'default'"
            :title="editMode ? '编辑模式' : '预览模式'"
            @click="editMode = !editMode"
          >
            {{ editMode ? '✎' : '◉' }}
          </el-button>
          <el-button
            v-if="hasParsed"
            size="small"
            :disabled="!canUndo"
            title="撤销 (Ctrl+Z)"
            @click="undoIrChange"
          >
            撤销
          </el-button>
          <el-button
            v-if="hasParsed"
            size="small"
            :disabled="!canRedo"
            title="重做 (Ctrl+Y / Ctrl+Shift+Z)"
            @click="redoIrChange"
          >
            重做
          </el-button>
          <el-button
            v-if="hasParsed && !openIsDemo && !isNewDraft"
            size="small"
            :disabled="!nlsLocaleOptions.length"
            @click="openNlsTreeForSelectedControl"
          >
            编辑文案
          </el-button>
          <el-select
            v-if="nlsLocaleOptions.length > 1 && !isNewDraft"
            :model-value="nlsEditorLocale"
            size="small"
            style="width: 160px"
            @update:model-value="(v: string) => setNlsEditorLocale(v)"
          >
            <el-option
              v-for="opt in nlsLocaleOptions"
              :key="opt.id"
              :label="opt.label"
              :value="opt.id"
            />
          </el-select>
          <el-select
            v-else-if="nlsLocaleOptions.length === 1 && hasParsed"
            :model-value="nlsEditorLocale"
            size="small"
            style="width: 160px"
            disabled
          >
            <el-option
              v-for="opt in nlsLocaleOptions"
              :key="opt.id"
              :label="opt.label"
              :value="opt.id"
            />
          </el-select>
          <el-button
            v-if="canPreviewWrite"
            size="small"
            :loading="writePreviewLoading"
            title="先用 dry-run 预览 IR 写回 .CATDlg / Wizard .h/.cpp 的文本差异"
            @click="previewWriteback"
          >
            预览写回
          </el-button>
          <el-button
            v-if="!isNewDraft"
            type="success"
            size="small"
            :loading="saving"
            :disabled="!canSaveNls"
            @click="saveNls"
          >
            保存
          </el-button>
          <el-button
            v-if="isNewDraft"
            type="success"
            size="small"
            :loading="saving"
            @click="openModulePicker"
          >
            创建文件…
          </el-button>
          <el-button v-if="!isNewDraft" type="primary" size="small" :loading="parsing" @click="parseDialog">解析</el-button>
        </div>
      </template>
    </PageHeader>

    <el-alert
      v-if="hasNlsKeyMismatch && nlsKeyCountMismatch"
      type="warning"
      :closable="false"
      class="caa-nls-consistency-banner"
    >
      <template #title>
        <span>
          NLS 键数量不一致：英文 {{ nlsKeyCountMismatch.en }} 键，
          简体中文 {{ nlsKeyCountMismatch.cn }} 键
          <template v-if="nlsKeyCountMismatch.missingInCn.length">
            （简体中文缺少 {{ nlsKeyCountMismatch.missingInCn.length }} 键）
          </template>
          <template v-if="nlsKeyCountMismatch.missingInEn.length">
            （英文缺少 {{ nlsKeyCountMismatch.missingInEn.length }} 键）
          </template>
          <el-button type="warning" size="small" link style="margin-left: 8px" @click="openSupplementDialog">
            补全缺失键
          </el-button>
        </span>
      </template>
    </el-alert>

    <CaaDialogEditorView :has-parsed="hasParsed" />

    <!-- 拖放指示器（页面级 position:fixed，最高层级，唯一视觉反馈） -->
    <CaaDropOverlay />

    <CaaDialogRelatedFilesTable v-if="localIr" :ir="localIr" />
    <CaaDialogRscPreviewPanel v-if="localIr" :ir="localIr" />

    <!-- NLS 编辑器（页面内嵌面板，最后） -->
    <CaaNlsTreeEditor
      :open="nlsTreeEditorOpen"
      :root="localIr?.root ?? null"
      :en-flat="currentNlsFlat"
      :cn-flat="localeNlsFlats[CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]"
      :compare-mode="hasChineseLocale"
      :dirty="nlsIsDirtyAll()"
      :focus-node-id="nlsFocusNodeId"
      :initial-locale-mode="nlsTreeLocaleMode"
      :can-create-cn="canCreateChinese"
      @close="nlsTreeEditorOpen = false"
      @update:value="setNlsFlatKey"
      @save="saveNls({ gridSave: false })"
      @create-cn="createChineseLocale"
      @locale-change="onNlsEditorLocaleChange"
    />

    <CaaNlsSupplementDialog
      :open="supplementDialogOpen"
      :direction="supplementDirection"
      :missing-keys="supplementMissingKeys"
      :applying="supplementing"
      @close="supplementDialogOpen = false"
      @update:direction="(v) => (supplementDirection = v)"
      @apply:keys="supplementNlsKeys"
    />

    <CaaControlContextMenu />

    <CaaDialogWritePreviewDialog
      :open="writePreviewOpen"
      :loading="writePreviewLoading"
      :cat-dlg-rel="catDlgRel"
      :preview="writePreviewResult"
      @close="writePreviewOpen = false"
      @confirm="confirmWritePreview"
    />

    <!-- 模块目录选择器（新建对话框时） -->
    <el-dialog v-model="modulePickerOpen" title="选择模块目录" width="480px" :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="目标模块目录（目录名含 . 的 CAA 模块）">
          <el-select
            v-model="selectedModuleDir"
            filterable
            allow-create
            :loading="loadingModuleDirs"
            :placeholder="loadingModuleDirs ? '扫描模块目录…' : '选择或输入模块目录'"
            style="width: 100%"
          >
            <el-option
              v-for="d in moduleDirs"
              :key="d"
              :label="d"
              :value="d"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="对话框名称">
          <el-input v-model="newDialogName" placeholder="如 MyDialog" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="modulePickerOpen = false">取消</el-button>
        <el-button type="primary" :disabled="!selectedModuleDir.trim() || !newDialogName.trim()" :loading="saving" @click="saveDialogToDisk">
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.caa-nls-consistency-banner {
  margin-bottom: 10px;
  flex-shrink: 0;
}

.caa-dialog-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  height: auto;
  box-sizing: border-box;
}
</style>
