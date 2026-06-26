import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { CaaHealthPayload } from "../api/caaDialog";
import type { CaaDialogIr } from "../types/caaDialogIr";
import { CAA_SERVICE_DEFAULT_PORT, caaServiceBaseUrl } from "../constants/caaService";

type CaaEditorState = {
  ir: CaaDialogIr | null;
  selectedId: string | null;
  loading: boolean;
  errorText: string;
  relatedFilesCollapsed: boolean;
};

function emptyEditorState(): CaaEditorState {
  return {
    ir: null,
    selectedId: null,
    loading: false,
    errorText: "",
    relatedFilesCollapsed: true,
  };
}

/** CAA 编辑状态按 Tab 隔离，active editor 供侧栏控件树 / 属性面板读取。 */
export const useCaaDialogPageStore = defineStore("caaDialogPage", () => {
  const activeEditorId = ref<string | null>(null);
  const editors = ref<Record<string, CaaEditorState>>({});
  const indexViewMode = ref<"tree" | "table">("table");
  // 工具箱：布局/密度/折叠，跨页面保持
  const paletteCollapsed = ref(false);
  const paletteLayout = ref<"vertical" | "horizontal">("vertical");
  const paletteDensity = ref<"grid" | "ribbon">("grid");

  function editorId(id?: string | null): string {
    return id?.trim() || "__default__";
  }

  function ensureEditor(id?: string | null): CaaEditorState {
    const key = editorId(id ?? activeEditorId.value);
    if (!editors.value[key]) editors.value[key] = emptyEditorState();
    return editors.value[key];
  }

  function getEditor(id?: string | null): CaaEditorState | null {
    const key = id ? editorId(id) : activeEditorId.value;
    return key ? (editors.value[key] ?? null) : null;
  }

  const activeEditor = computed(() =>
    activeEditorId.value ? getEditor(activeEditorId.value) : null,
  );

  const ir = computed(() => activeEditor.value?.ir ?? null);
  const selectedId = computed(() => activeEditor.value?.selectedId ?? null);
  const loading = computed({
    get: () => activeEditor.value?.loading ?? false,
    set: (value) => {
      const state = activeEditor.value;
      if (state) state.loading = value;
    },
  });
  const errorText = computed({
    get: () => activeEditor.value?.errorText ?? "",
    set: (value) => {
      const state = activeEditor.value;
      if (state) state.errorText = value;
    },
  });
  const caaOnline = ref<boolean | null>(null);
  const caaServicePort = ref<number>(CAA_SERVICE_DEFAULT_PORT);
  const caaServiceUrl = ref<string>(caaServiceBaseUrl());

  function setCaaHealth(health: CaaHealthPayload | null, online: boolean) {
    caaOnline.value = online;
    if (health?.port) {
      caaServicePort.value = health.port;
      caaServiceUrl.value = health.url ?? caaServiceBaseUrl(health.port);
    } else if (!online) {
      caaServicePort.value = CAA_SERVICE_DEFAULT_PORT;
      caaServiceUrl.value = caaServiceBaseUrl(CAA_SERVICE_DEFAULT_PORT);
    }
  }

  function setActiveEditor(id: string | null) {
    activeEditorId.value = id ? editorId(id) : null;
    if (activeEditorId.value) ensureEditor(activeEditorId.value);
  }

  function setIr(value: CaaDialogIr | null, id?: string | null) {
    ensureEditor(id).ir = value;
  }

  function setSelectedId(id: string | null, editor?: string | null) {
    ensureEditor(editor).selectedId = id;
  }

  function setEditorStatus(
    patch: Partial<Pick<CaaEditorState, "loading" | "errorText">>,
    id?: string | null,
  ) {
    const state = ensureEditor(id);
    if (patch.loading !== undefined) state.loading = patch.loading;
    if (patch.errorText !== undefined) state.errorText = patch.errorText;
  }

  function syncEditorState(
    id: string | null,
    state: Partial<CaaEditorState>,
  ) {
    const target = ensureEditor(id);
    if (state.ir !== undefined) target.ir = state.ir;
    if (state.selectedId !== undefined) target.selectedId = state.selectedId;
    if (state.loading !== undefined) target.loading = state.loading;
    if (state.errorText !== undefined) target.errorText = state.errorText;
  }

  /** 当前 active editor 的关联文件表折叠状态（默认收起） */
  const relatedFilesCollapsed = computed(() => activeEditor.value?.relatedFilesCollapsed ?? true);
  /** NLS 表格列宽百分比（ctrl / en / cn） */
  const nlsColWidths = ref({ ctrl: 30, en: 35, cn: 35 });

  function toggleRelatedFiles(id?: string | null) {
    const state = ensureEditor(id);
    state.relatedFilesCollapsed = !state.relatedFilesCollapsed;
  }
  function setNlsColWidths(w: { ctrl?: number; en?: number; cn?: number }) {
    nlsColWidths.value = { ...nlsColWidths.value, ...w };
  }

  function clearEditor(id?: string | null) {
    const key = id ? editorId(id) : activeEditorId.value;
    if (!key) return;
    delete editors.value[key];
    if (activeEditorId.value === key) activeEditorId.value = null;
  }

  return {
    activeEditorId,
    ir,
    selectedId,
    loading,
    errorText,
    caaOnline,
    caaServicePort,
    caaServiceUrl,
    indexViewMode,
    paletteCollapsed,
    paletteLayout,
    paletteDensity,
    relatedFilesCollapsed,
    nlsColWidths,
    setCaaHealth,
    setActiveEditor,
    setIr,
    setSelectedId,
    setEditorStatus,
    syncEditorState,
    toggleRelatedFiles,
    setNlsColWidths,
    clearEditor,
  };
});
