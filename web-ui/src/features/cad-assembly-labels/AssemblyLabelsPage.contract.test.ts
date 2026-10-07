import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
it("uses a shared directory and Primary progress, explicit confirmation, one ASSY row and detail navigation", () => {
  const page = source("./AssemblyLabelsPage.vue");
  expect(page).toContain("useCadBatchDirectory"); expect(page).toContain("shared.bindBusy(busy)");
  expect(page).toContain('defaultChoiceId: "cancel"'); expect(page).toContain('answer.choiceId === "apply"');
  expect(page).toContain('v-for="{ row, state } in visible"'); expect(page).toContain("row.pending");
  expect(page).toContain('subTab: "assembly"'); expect(page).toContain("hiddenSelected");
  expect(page).toContain("progress: computed<PagePrimaryProgress>"); expect(page).not.toMatch(/startCadIndexScan|fetchCadIndexScan/);
  expect(source("../../layout/pageRegistry.ts")).toContain('assembly_labels:');
});
