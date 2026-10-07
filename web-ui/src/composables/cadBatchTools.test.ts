import { expect, it, vi } from "vitest";
import { CAD_BATCH_TOOLS, cadBatchToolsSection, cadBatchNavigationPage } from "./cadBatchTools";
it("opens existing independent views through Host commands, without duplicating their implementation", () => {
  const openTab = vi.fn(); const section = cadBatchToolsSection({ openTab }, "cad_batch_tools");
  expect(section.actions?.[0].disabled).toBe(true);
  expect(section.placement).toBe("before-context");
  expect(section.actionLayout).toBe("grid");
  for (const action of section.actions!.slice(1)) action.run();
  expect(openTab.mock.calls.map(([opts]) => opts.pageId)).toEqual(["xlink_fix", "batch_attributes", "name_normalize", "document_sync", "assembly_labels", "part_gallery", "step_batch", "sw_step_export", "part_dedup"]);
  expect(CAD_BATCH_TOOLS).toHaveLength(9);
});
it("keeps hidden tool Views in the CAD navigation group without affecting other pages", () => {
  for (const tool of CAD_BATCH_TOOLS) expect(cadBatchNavigationPage(tool.page)).toBe("cad_batch_tools");
  expect(cadBatchNavigationPage("part_catalog")).toBe("part_catalog");
});
