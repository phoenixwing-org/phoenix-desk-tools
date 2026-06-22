import { computed, nextTick, ref } from "vue";
import {
  fetchCodeIgnorePrefs,
  saveCodeIgnorePrefs,
  type CodeIgnorePrefs,
} from "../api";
import { useAppShell } from "./useAppShell";

export const CONSUMER_LABELS: Record<string, string> = {
  code_index: "Code 索引",
  reorder_members: "C++ 成员排序",
  code_rename: "批量改名",
  code_uuid: "UUID 替换",
};

export function formatConsumerScope(ids: string[]): string {
  if (!ids.length) return "—";
  return ids.map((id) => CONSUMER_LABELS[id] || id).join(" · ");
}

function parseCustomLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function useCodeIgnoreForm() {
  const shell = useAppShell();

  const loading = ref(false);
  const saving = ref(false);

  const ignoreFileDisplay = ref("");
  const ignoreFileExists = ref(false);
  const ignoreFilePatterns = ref<string[]>([]);
  const ignoreBuiltinCount = ref(0);
  const legacySources = ref<Array<{ filename: string; patterns: string[] }>>([]);
  const customIgnoreText = ref("");
  const ignorePreset = ref("");
  const ignorePresets = ref<Array<{ id: string; label: string; patterns: string[] }>>([]);
  const consumers = ref<string[]>([]);
  const processDirSuggestions = ref<
    Array<{
      name: string;
      kind: string;
      reason: string;
      repo_rel_path: string;
      suggested_pattern: string;
    }>
  >([]);
  const processDirsAutoSeeded = ref<string[]>([]);

  const hasProcessSuggestions = computed(() => processDirSuggestions.value.length > 0);
  const autoSeedNotice = computed(() => {
    const seeded = processDirsAutoSeeded.value;
    if (!seeded.length) return "";
    return `首次打开已自动加入忽略：${seeded.join("、")}`;
  });

  const customLineCount = computed(() => parseCustomLines(customIgnoreText.value).length);
  const mergedIgnoreCount = computed(
    () => ignoreBuiltinCount.value + ignoreFilePatterns.value.length + customLineCount.value,
  );
  const consumerScope = computed(() => formatConsumerScope(consumers.value));
  const ignoreFileStatus = computed(() =>
    ignoreFileExists.value ? "已加载" : "未建则读旧文件或仅内置",
  );
  const legacySourceCount = computed(() =>
    legacySources.value.reduce((n, s) => n + s.patterns.length, 0),
  );

  /** 阻止 applyPrefs 写入预设时 el-select @change 再次触发 onApplyPreset */
  let applyingPrefs = false;

  function applyPrefs(data: CodeIgnorePrefs) {
    applyingPrefs = true;
    ignoreFileDisplay.value = data.ignore_file_display || data.ignore_file;
    ignoreFileExists.value = data.ignore_file_exists;
    ignoreFilePatterns.value = data.ignore_file_patterns || [];
    ignoreBuiltinCount.value = data.ignore_builtin?.length ?? 0;
    legacySources.value = data.legacy_ignore_sources || [];
    customIgnoreText.value = (data.custom_ignore || []).join("\n");
    ignorePreset.value = data.ignore_preset || "";
    ignorePresets.value = data.ignore_presets || [];
    consumers.value = data.consumers || [];
    processDirSuggestions.value = data.process_dir_suggestions || [];
    processDirsAutoSeeded.value = data.process_dirs_auto_seeded || [];
    if (processDirsAutoSeeded.value.length) {
      shell.setStatus(autoSeedNotice.value);
    }
    void nextTick(() => {
      applyingPrefs = false;
    });
  }

  async function loadPrefs() {
    loading.value = true;
    try {
      applyPrefs(await fetchCodeIgnorePrefs());
    } catch (e) {
      shell.setStatus(String(e));
    } finally {
      loading.value = false;
    }
  }

  function onApplySuggestions() {
    const lines = parseCustomLines(customIgnoreText.value);
    const seen = new Set(lines.map((l) => l.toLowerCase()));
    let added = 0;
    for (const item of processDirSuggestions.value) {
      const pat = item.suggested_pattern || item.name;
      if (!pat || seen.has(pat.toLowerCase())) continue;
      lines.push(pat);
      seen.add(pat.toLowerCase());
      added += 1;
    }
    if (!added) {
      shell.setStatus("推荐项已在自定义列表中");
      return;
    }
    customIgnoreText.value = lines.join("\n");
    shell.setStatus(`已填入 ${added} 条过程目录推荐，保存后生效`);
  }

  async function onSave(): Promise<CodeIgnorePrefs | undefined> {
    saving.value = true;
    try {
      const out = await saveCodeIgnorePrefs({
        custom_ignore: parseCustomLines(customIgnoreText.value),
        ignore_preset: ignorePreset.value,
      });
      applyPrefs(out);
      shell.setStatus("已保存 Code 忽略配置");
      return out;
    } catch (e) {
      shell.setStatus(String(e));
      return undefined;
    } finally {
      saving.value = false;
    }
  }

  function onApplyPreset() {
    if (applyingPrefs || !ignorePreset.value) return;
    const preset = ignorePresets.value.find((p) => p.id === ignorePreset.value);
    if (preset?.patterns?.length) {
      customIgnoreText.value = preset.patterns.join("\n");
      shell.setStatus(`已填入 ${preset.label} 预设，保存后生效`);
    }
  }

  return {
    loading,
    saving,
    ignoreFileDisplay,
    ignoreFileExists,
    ignoreFilePatterns,
    ignoreBuiltinCount,
    legacySources,
    customIgnoreText,
    ignorePreset,
    ignorePresets,
    consumers,
    processDirSuggestions,
    processDirsAutoSeeded,
    hasProcessSuggestions,
    customLineCount,
    mergedIgnoreCount,
    consumerScope,
    ignoreFileStatus,
    legacySourceCount,
    loadPrefs,
    onApplySuggestions,
    onSave,
    onApplyPreset,
  };
}

export type CodeIgnoreForm = ReturnType<typeof useCodeIgnoreForm>;
