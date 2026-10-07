import { createPinia, setActivePinia } from "pinia";
import { effectScope, ref } from "vue";
import { beforeEach, expect, it } from "vitest";
import { useWorkspaceTreeExpansion } from "./useWorkspaceTreeExpansion";

beforeEach(() => setActivePinia(createPinia()));
it("keeps temporary search expansion separate from remembered normal folders", () => {
  const scope = effectScope(), workspace = ref("/fixture"), query = ref("");
  const tree = scope.run(() => useWorkspaceTreeExpansion(workspace, query))!;
  try {
    tree.toggle("parts", true); tree.toggle("sheets", false);
    query.value = "plate";
    expect(tree.searching.value).toBe(true); expect(tree.expansion.value.size).toBe(0);
    tree.toggle("parts", false); expect(tree.expansion.value.get("parts")).toBe(false);
    query.value = "plate 002"; expect(tree.expansion.value.size).toBe(0);
    query.value = "";
    expect(tree.expansion.value.get("parts")).toBe(true);
    expect(tree.expansion.value.get("sheets")).toBe(false);
    workspace.value = "/fixture-other"; expect(tree.expansion.value.size).toBe(0);
    workspace.value = "/fixture"; expect(tree.expansion.value.get("parts")).toBe(true);
  } finally { scope.stop(); }
});
it("preserves directory state across tree component remounts", () => {
  const workspace = ref("/fixture"), query = ref("");
  const first = effectScope();
  first.run(() => useWorkspaceTreeExpansion(workspace, query).toggle("parts/deep", true));
  first.stop();
  const second = effectScope();
  try { expect(second.run(() => useWorkspaceTreeExpansion(workspace, query))!.expansion.value.get("parts/deep")).toBe(true); }
  finally { second.stop(); }
});
