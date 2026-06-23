<script setup lang="ts">
import { computed, onActivated, onMounted, provide, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  applyNlsPropToNode,
  applyNlsKeyToRoot,
  CAA_NLS_LOCALE_SIMPLIFIED_CHINESE,
  parseCatNls,
} from "@phoenix/catdlg-core";
import PageHeader from "../components/PageHeader.vue";
import CaaDialogEditorView from "../components/caa/CaaDialogEditorView.vue";
import CaaCatNlsEditDialog from "../components/caa/CaaCatNlsEditDialog.vue";
import CaaNlsSupplementDialog from "../components/caa/CaaNlsSupplementDialog.vue";
import type { NlsSupplementDirection } from "../components/caa/CaaNlsSupplementDialog.vue";
import type { CaaNlsLocaleOption, CaaNlsDisplayMode } from "../components/caa/CaaCatNlsEditDialog.vue";
import {
  createCaaDialogLocaleNls,
  fetchCaaHealth,
  parseCaaDialog,
  saveCaaDialogNls,
} from "../api/caaDialog";
import { CAA_EDITOR_PAGE_ID } from "../constants/caaPages";
import { useCaaDialogPropertySheet } from "../composables/useCaaDialogPropertySheet";
import { CAA_NLS_EDIT_KEY, CAA_NLS_SESSION_KEY, type CaaNlsEditTarget } from "../composables/caaNlsEdit";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";
import { usePageSummary } from "../composables/usePageSummary";
import { useCaaDialogPageStore } from "../stores/caaDialogPage";
import type { CaaDialogIr } from "../types/caaDialogIr";
import { dialogNameFromCatDlgRel } from "../utils/caaDialogDisplay";
import { findCaaNode, nlsFlatMapsEqual } from "../utils/caaDialogTree";

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
const parsing = ref(false);
const saving = ref(false);
const localErrorText = ref("");
const hasParsed = ref(false);
const openIsDemo = ref(false);

const baselineNlsFlat = ref<Record<string, string>>({});
const currentNlsFlat = ref<Record<string, string>>({});
const nlsSourceText = ref("");
const nlsEditorOpen = ref(false);
const nlsEditorLocale = ref("default");
const nlsDisplayMode = ref<CaaNlsDisplayMode>("en");
const creatingChinese = ref(false);
const supplementDialogOpen = ref(false);
const supplementDirection = ref<NlsSupplementDirection>("en-to-cn");
const supplementMissingKeys = ref<string[]>([]);
const supplementing = ref(false);
const localeNlsFlats = ref<Record<string, Record<string, string>>>({});
const localeBaselineFlats = ref<Record<string, Record<string, string>>>({});
const localeSourceTexts = ref<Record<string, string>>({});

const catDlgRel = computed(() => {
  if (!props.workbenchTabId) return "";
  return shell.getTab(props.workbenchTabId)?.contextKey?.trim() ?? "";
});

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

const currentNlsPath = computed(() => {
  const opt = nlsLocaleOptions.value.find((o) => o.id === nlsEditorLocale.value);
  const rel = opt?.catNlsRel ?? "";
  if (!rel) return "";
  return `${opt!.label} · ${rel}`;
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

const nlsEditorRows = computed(() => {
  const flat =
    nlsEditorLocale.value === "default"
      ? currentNlsFlat.value
      : localeNlsFlats.value[nlsEditorLocale.value] ?? {};
  return Object.keys(flat)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((key) => ({ key, value: flat[key] ?? "" }));
});

const enNlsRows = computed(() => {
  const flat = currentNlsFlat.value;
  return Object.keys(flat)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((key) => ({ key, value: flat[key] ?? "" }));
});

const cnNlsRows = computed(() => {
  const flat = localeNlsFlats.value[CAA_NLS_LOCALE_SIMPLIFIED_CHINESE] ?? {};
  return Object.keys(flat)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((key) => ({ key, value: flat[key] ?? "" }));
});

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
  nlsEditorLocale.value = localeId;
  nlsDisplayMode.value = localeId === "default" ? "en" : "cn";
  nlsEditorOpen.value = true;
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
    nlsEditorLocale.value = id;
    nlsDisplayMode.value = "cn";
    nlsEditorOpen.value = true;
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

function autoFillNlsCompare() {
  const enFlat = currentNlsFlat.value;
  const cnFlat = localeNlsFlats.value[CAA_NLS_LOCALE_SIMPLIFIED_CHINESE] ?? {};
  if (!Object.keys(enFlat).length && !Object.keys(cnFlat).length) return;

  const allKeys = new Set([...Object.keys(enFlat), ...Object.keys(cnFlat)]);
  let enChanged = false;
  let cnChanged = false;
  const newEn = { ...enFlat };
  const newCn = { ...cnFlat };

  for (const key of allKeys) {
    const enVal = (enFlat[key] ?? "").trim();
    const cnVal = (cnFlat[key] ?? "").trim();
    if (enVal && !cnVal) {
      newCn[key] = enVal;
      cnChanged = true;
    } else if (cnVal && !enVal) {
      newEn[key] = cnVal;
      if (localIr.value) {
        applyNlsKeyToRoot(localIr.value.root, key, cnVal);
        if (key === "Title") localIr.value.title = cnVal;
      }
      enChanged = true;
    }
  }

  if (enChanged) currentNlsFlat.value = newEn;
  if (cnChanged) {
    localeNlsFlats.value = {
      ...localeNlsFlats.value,
      [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: newCn,
    };
  }

  if (enChanged || cnChanged) {
    syncTabDirty();
    syncToSidebar();
    const parts: string[] = [];
    if (enChanged) parts.push("英文");
    if (cnChanged) parts.push("简体中文");
    ElMessage.success(`已自动填写空缺值 → ${parts.join("、")}`);
  } else {
    ElMessage.info("没有需要填写的空缺值");
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
  () =>
    hasParsed.value &&
    !openIsDemo.value &&
    Boolean(localIr.value?.sources.catNls) &&
    Boolean(workspacePath.value) &&
    nlsIsDirtyAll(),
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

function syncTabDirty() {
  if (!props.workbenchTabId) return;
  shell.updateTab(props.workbenchTabId, { dirty: nlsIsDirtyAll() });
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
  nlsEditorLocale.value = "default";
  syncTabDirty();
}

function syncToSidebar() {
  if (!isActiveTab()) return;
  store.setIr(localIr.value);
  store.setSelectedId(localSelectedId.value);
  store.loading = parsing.value;
  store.errorText = localErrorText.value;
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

function resolveOpenTarget(): { catDlgRel: string; isDemo: boolean } | null {
  if (!props.workbenchTabId) return null;
  const payload = shell.consumeTabPayload(props.workbenchTabId);
  const fromPayload = payload?.caaDialog;
  if (fromPayload?.catDlgRel?.trim()) {
    return { catDlgRel: fromPayload.catDlgRel.trim(), isDemo: Boolean(fromPayload.isDemo) };
  }
  const rel = catDlgRel.value;
  if (rel) return { catDlgRel: rel, isDemo: false };
  return null;
}

async function parseDialog() {
  const target = resolveOpenTarget();
  if (!target) {
    localErrorText.value = "未指定 .CATDlg 路径";
    localIr.value = null;
    localSelectedId.value = null;
    hasParsed.value = false;
    syncToSidebar();
    return;
  }

  openIsDemo.value = target.isDemo;
  parsing.value = true;
  localErrorText.value = "";
  syncToSidebar();
  shell.appendLog(`[CAA 对话框] 解析 ${target.catDlgRel}…`, { source: PAGE_ID, open: true });
  try {
    const ir = await parseCaaDialog(
      target.isDemo
        ? { demo: true, workspaceRoot: "", catDlgRel: target.catDlgRel }
        : { workspaceRoot: workspacePath.value, catDlgRel: target.catDlgRel },
    );
    localIr.value = ir;
    localSelectedId.value = ir.dialogName;
    hasParsed.value = true;
    initNlsSession(ir);
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, {
        title: dialogNameFromCatDlgRel(target.catDlgRel),
        subtitle: target.catDlgRel.split("/").pop() ?? `${ir.dialogName}.CATDlg`,
        dirty: false,
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

async function saveNls() {
  const ir = localIr.value;
  const catNlsRel = ir?.sources.catNls?.trim();
  const ws = workspacePath.value;
  if (!ir || !catNlsRel || !ws) {
    ElMessage.warning("无法保存：缺少工作空间或 .CATNls 路径");
    return;
  }
  if (openIsDemo.value) {
    ElMessage.warning("Demo 对话框不支持保存到磁盘");
    return;
  }
  saving.value = true;
  try {
    if (nlsIsDirty()) {
      shell.appendLog(`[CAA 对话框] 保存 .CATNls → ${catNlsRel}`, { source: PAGE_ID, open: true });
      const result = await saveCaaDialogNls({
        workspaceRoot: ws,
        catNlsRel,
        nlsKeys: { ...currentNlsFlat.value },
        sourceText: nlsSourceText.value,
      });
      nlsSourceText.value = result.sourceText;
      if (ir.parseMeta) ir.parseMeta.catNlsSourceText = result.sourceText;
      baselineNlsFlat.value = { ...currentNlsFlat.value };
      shell.appendLog(`[CAA 对话框] 已写入 ${result.absPath}`, { source: PAGE_ID });
    }

    const nlsLocales = ir.sources.nlsLocales ?? {};
    for (const [localeId, rel] of Object.entries(nlsLocales)) {
      if (!rel || rel === catNlsRel) continue;
      const flat = localeNlsFlats.value[localeId];
      const baseline = localeBaselineFlats.value[localeId] ?? {};
      if (!flat || nlsFlatMapsEqual(baseline, flat)) continue;
      shell.appendLog(`[CAA 对话框] 保存 .CATNls → ${rel}`, { source: PAGE_ID, open: true });
      const result = await saveCaaDialogNls({
        workspaceRoot: ws,
        catNlsRel: rel,
        nlsKeys: { ...flat },
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
    }

    syncTabDirty();
    ElMessage.success("已保存 .CATNls");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(msg);
    shell.appendLog(`[CAA 对话框] 保存失败：${msg}`, { source: PAGE_ID, open: true });
  } finally {
    saving.value = false;
  }
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({
    nlsFlat: currentNlsFlat.value,
    nlsSourceText: nlsSourceText.value,
    localeNlsFlats: localeNlsFlats.value,
  }),
  hydrate: async () => false,
  isDirty: nlsIsDirtyAll,
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

onMounted(() => {
  void checkHealth();
  void parseDialog();
});

onActivated(() => {
  syncToSidebar();
});
</script>

<template>
  <div class="page tool-page caa-dialog-page">
    <PageHeader :title="pageTitle" :page-id="PAGE_ID">
      <template #actions>
        <div class="head-actions-inner">
          <el-button
            v-if="hasParsed && !openIsDemo"
            size="small"
            :disabled="!nlsLocaleOptions.length"
            @click="openCatNlsEditor()"
          >
            编辑 CATNls
          </el-button>
          <el-select
            v-if="nlsLocaleOptions.length > 1"
            :model-value="nlsEditorLocale"
            size="small"
            style="width: 160px"
            @update:model-value="(v: string) => (nlsEditorLocale = v)"
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
            v-if="canCreateChinese"
            type="primary"
            size="small"
            :loading="creatingChinese"
            @click="createChineseLocale"
          >
            添加简体中文
          </el-button>
          <el-button
            type="success"
            size="small"
            :loading="saving"
            :disabled="!canSaveNls"
            @click="saveNls"
          >
            保存
          </el-button>
          <el-button type="primary" size="small" :loading="parsing" @click="parseDialog">解析</el-button>
        </div>
      </template>
    </PageHeader>

    <p v-if="currentNlsPath && hasParsed" class="caa-nls-current-path mono muted small">
      {{ currentNlsPath }}
    </p>

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

    <CaaCatNlsEditDialog
      :open="nlsEditorOpen"
      :rows="nlsEditorRows"
      :dirty="nlsIsDirtyAll()"
      :active-path="currentNlsPath"
      :display-mode="nlsDisplayMode"
      :en-rows="enNlsRows"
      :cn-rows="cnNlsRows"
      :has-chinese="hasChineseLocale"
      @close="nlsEditorOpen = false"
      @update:value="setNlsFlatKey"
      @update:display-mode="(v) => (nlsDisplayMode = v)"
      @auto-fill="autoFillNlsCompare"
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
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.caa-nls-current-path {
  margin: 0 0 6px;
  word-break: break-all;
  flex-shrink: 0;
}

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
