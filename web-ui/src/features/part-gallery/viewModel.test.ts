import { expect, it } from "vitest";
import { visibleGalleryRows } from "./viewModel";
import type { GalleryRow } from "./api";
const row = (rel: string, pn: string, type: string, role = "part", status = "ready") => ({ rel, part_number: pn, part_version: "003", part_name: "示例件", type_code: type, role, status } as GalleryRow);
it("filters entirely client-side and sorts category then natural part number", () => {
  const rows = [row("S", "2", "S"), row("H10", "10", "H"), row("H2", "2", "H"), row("Asm", "1", "H", "assembly"), row("Drawing", "0", "H", "drawing"), row("Missing", "20", "H", "part", "missing")];
  expect(visibleGalleryRows(rows, "", "", false, false).map(r => r.rel)).toEqual(["H2", "H10", "Missing", "S"]);
  expect(visibleGalleryRows(rows, "", "H", true, true).map(r => r.rel)).toEqual(["Missing"]);
  expect(visibleGalleryRows(rows, "h10", "", true, false).map(r => r.rel)).toEqual(["H10"]);
  expect(rows[0].rel).toBe("S");
});
