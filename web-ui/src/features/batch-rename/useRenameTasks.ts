import { computed, ref, watch, type Ref } from "vue";
import { applyTask, loadTasks, previewTask, saveTask, type RenamePreview, type RenameResults, type RenameTask, type TaskDraft } from "./api";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const blank = (): TaskDraft => ({ name: "新改名任务", mappings: [{ old: "", target: "", enabled: true }], roots: [], directories: false, filenames: true, contents: true, include_stem: false });
const fields = ({ name, mappings, roots, directories = false, filenames, contents, include_stem }: TaskDraft): TaskDraft => clone({ name, mappings, roots, directories, filenames, contents, include_stem });

export function useRenameTasks(workspace: Ref<string>, report: (text: string, error: boolean) => void, changed: (workspace: string) => void) {
  const tasks = ref<RenameTask[]>([]), activeId = ref(""), draft = ref<TaskDraft>(blank());
  const busy = ref(false), error = ref(""), phase = ref("");
  const preview = ref<RenamePreview | null>(null), results = ref<RenameResults | null>(null), selected = ref<string[]>([]), consumed = ref(false);
  let epoch = 0;
  const active = computed(() => tasks.value.find(task => task.id === activeId.value));
  const dirty = computed(() => !!active.value && JSON.stringify(fields(active.value)) !== JSON.stringify(draft.value));
  const canPreview = computed(() => !!active.value && !busy.value && draft.value.roots.length > 0 && (draft.value.directories || draft.value.filenames || draft.value.contents) && draft.value.mappings.some(row => row.enabled && row.old.trim() && row.target.trim()));
  const canApply = computed(() => !!active.value && !!preview.value && !busy.value && !dirty.value && !consumed.value && !preview.value.conflicts.length && selected.value.length > 0);
  function invalidate() { preview.value = null; results.value = null; selected.value = []; consumed.value = false; }
  function fail(cause: unknown) { error.value = cause instanceof Error ? cause.message : String(cause); report(error.value, true); }
  function choose(id: string) {
    if (busy.value) return;
    const task = tasks.value.find(item => item.id === id);
    if (!task) return;
    activeId.value = id; draft.value = fields(task); invalidate(); error.value = "";
  }
  function update(task: RenameTask) { tasks.value = [task, ...tasks.value.filter(item => item.id !== task.id)]; }
  async function load() {
    if (busy.value || !workspace.value) return;
    const token = ++epoch, ws = workspace.value, selectedTask = activeId.value;
    invalidate();
    busy.value = true; error.value = ""; phase.value = "读取改名任务";
    try {
      const data = await loadTasks(ws);
      if (token !== epoch || ws !== workspace.value) return;
      tasks.value = data.tasks; activeId.value = data.tasks.find(task => task.id === selectedTask)?.id || data.tasks[0]?.id || "";
      draft.value = active.value ? fields(active.value) : blank(); invalidate();
    } catch (cause) { if (token === epoch) fail(cause); }
    finally { if (token === epoch) { busy.value = false; phase.value = ""; } }
  }
  async function save(asNew = false, value = draft.value) {
    if (busy.value || !workspace.value || (!asNew && !active.value)) return false;
    const token = ++epoch, ws = workspace.value, original = active.value, snapshot = fields(value);
    busy.value = true; error.value = ""; phase.value = "保存改名任务";
    try {
      const task = await saveTask(ws, snapshot, asNew ? undefined : original?.id, asNew ? undefined : original?.revision);
      if (token !== epoch || ws !== workspace.value) return false;
      const editedWhileSaving = !asNew && JSON.stringify(draft.value) !== JSON.stringify(snapshot);
      update(task); activeId.value = task.id;
      if (!editedWhileSaving) draft.value = fields(task);
      invalidate();
      return !editedWhileSaving;
    } catch (cause) { if (token === epoch) fail(cause); return false; }
    finally { if (token === epoch) { busy.value = false; phase.value = ""; } }
  }
  const create = (copy = false) => save(true, copy ? { ...fields(draft.value), name: `${draft.value.name} 副本`.slice(0, 120) } : blank());
  async function search() {
    if (!canPreview.value) return;
    const startWorkspace = workspace.value, startTask = activeId.value;
    if (dirty.value && !await save()) return;
    if (workspace.value !== startWorkspace || activeId.value !== startTask || !canPreview.value) return;
    const token = ++epoch, ws = workspace.value, task = clone(active.value!);
    busy.value = true; error.value = ""; phase.value = "搜索所选目录"; invalidate();
    try {
      const data = await previewTask(ws, task);
      if (token !== epoch || ws !== workspace.value || JSON.stringify(draft.value) !== JSON.stringify(fields(task))) return;
      preview.value = data;
      if (data.conflicts.length) report(data.conflicts.join("\n"), true);
      const latest = await loadTasks(ws);
      if (token === epoch && ws === workspace.value) {
        if (latest.tasks.find(item => item.id === task.id)?.revision !== task.revision) {
          // Keep the old revision with its configuration. Adopting only the new
          // revision would let a later save overwrite changes we never loaded.
          invalidate(); fail(new Error("任务已被修改或删除，请刷新任务后重新预览"));
        } else tasks.value = latest.tasks;
      }
    } catch (cause) { if (token === epoch) fail(cause); }
    finally { if (token === epoch) { busy.value = false; phase.value = ""; } }
  }
  async function apply() {
    if (!canApply.value) return;
    const token = ++epoch, ws = workspace.value, task = clone(active.value!), plan = preview.value!, ids = [...selected.value];
    busy.value = true; consumed.value = true; phase.value = "备份并逐文件应用"; error.value = "";
    try {
      const result = await applyTask(ws, task, plan.plan_id, ids);
      report(`任务「${task.name}」：已应用 ${result.applied} 个，失败 ${result.failed} 个\n${result.results.map(row => `${row.root}/${row.rel} → ${row.target}：${row.message}${row.backup ? `\n备份：${row.backup}` : ""}`).join("\n")}`, result.failed > 0);
      if (token !== epoch || ws !== workspace.value) return;
      results.value = result;
      const latest = await loadTasks(ws);
      if (token === epoch && ws === workspace.value) tasks.value = latest.tasks;
    } catch (cause) { if (token === epoch) fail(cause); else report(String(cause), true); }
    finally { changed(ws); if (token === epoch) { busy.value = false; phase.value = ""; } }
  }
  watch(draft, invalidate, { deep: true, flush: "sync" });
  watch(workspace, () => { epoch++; tasks.value = []; activeId.value = ""; draft.value = blank(); busy.value = false; phase.value = ""; error.value = ""; invalidate(); void load(); }, { immediate: true, flush: "sync" });
  return { tasks, activeId, active, draft, busy, error, phase, preview, results, selected, consumed, dirty, canPreview, canApply, choose, load, save, create, search, apply };
}
