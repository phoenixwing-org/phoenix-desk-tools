import { computed, ref, watch, type Ref } from "vue";
import { defineStore } from "pinia";
import type { RenamePreview, RenameRow } from "./api";
type Scope = { workspace: string; root: string; known: string[]; disabled: string[] };
const KEY = "phoenix-rename-extension-filters-v1";
const strings = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 255))].slice(0, 2000) : [];
function load(): Scope[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(data) ? data.filter(row => typeof row?.workspace === "string" && typeof row.root === "string").slice(0, 100).map(row => ({ workspace: row.workspace, root: row.root, known: strings(row.known), disabled: strings(row.disabled) })) : [];
  } catch { return []; }
}
const useExtensionFiltersStore = defineStore("renameExtensionFilters", {
  state: () => ({ scopes: load() }),
  actions: { persist() { try { localStorage.setItem(KEY, JSON.stringify(this.scopes)); } catch { /* Session state remains available. */ } } },
});
export function fileExtension(row: Pick<RenameRow, "rel">) {
  const name = row.rel.split("/").pop() || "", index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index).toLowerCase() : "";
}
export function useRenameExtensionFilter(workspace: Ref<string>, preview: Ref<RenamePreview | null>, selected: Ref<string[]>) {
  const store = useExtensionFiltersStore(), discovered = ref(new Set<string>());
  const scopeFor = (root: string) => store.scopes.find(item => item.workspace === workspace.value && item.root === root);
  const allowed = (row: RenameRow) => row.kind === "directory" || !scopeFor(row.root)?.disabled.includes(fileExtension(row));
  watch([workspace, preview], () => {
    discovered.value = new Set();
    if (!preview.value || !workspace.value) return;
    const touched: Scope[] = [];
    for (const root of preview.value.roots) {
      const extensions = [...new Set(preview.value.rows.filter(row => row.root === root).map(fileExtension))];
      const previous = scopeFor(root);
      if (previous) for (const extension of extensions) if (!previous.known.includes(extension)) discovered.value.add(extension);
      touched.push({ workspace: workspace.value, root, known: [...new Set([...(previous?.known || []), ...extensions])].slice(0, 2000), disabled: previous?.disabled || [] });
    }
    store.scopes = [...touched, ...store.scopes.filter(item => !touched.some(next => next.workspace === item.workspace && next.root === item.root))].slice(0, 100);
    store.persist();
  }, { immediate: true, flush: "sync" });
  const visibleRows = computed(() => preview.value?.rows.filter(allowed) || []);
  const filters = computed(() => {
    const groups = new Map<string, RenameRow[]>();
    for (const row of preview.value?.rows || []) { const extension = fileExtension(row); groups.set(extension, [...(groups.get(extension) || []), row]); }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([extension, rows]) => {
      const count = rows.filter(allowed).length, name = rows[0]!.rel.split("/").pop()!;
      return { extension, label: extension ? name.slice(name.lastIndexOf(".")) : "无后缀", count: rows.length, checked: count === rows.length, mixed: count > 0 && count < rows.length, isNew: discovered.value.has(extension) };
    });
  });
  function toggle(extension: string, checked: boolean) {
    for (const root of new Set(preview.value?.rows.filter(row => fileExtension(row) === extension).map(row => row.root))) {
      const scope = scopeFor(root);
      if (scope) scope.disabled = checked ? scope.disabled.filter(item => item !== extension) : [...new Set([...scope.disabled, extension])];
    }
    store.persist();
  }
  watch(() => [visibleRows.value.filter(row => row.eligible).map(row => row.id), [...selected.value]], () => {
    const visible = new Set(visibleRows.value.filter(row => row.eligible).map(row => row.id));
    const filtered = [...new Set(selected.value.filter(id => visible.has(id)))];
    if (filtered.length !== selected.value.length) selected.value = filtered;
  }, { immediate: true, flush: "sync" });
  return { visibleRows, filters, toggle };
}
