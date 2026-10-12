import { expect, it } from "vitest";
import { boundingBoxText, boundingBoxTitle, category, visibleGalleryRows } from "./viewModel";
import type { GalleryRow } from "./api";
const row = (rel: string, pn: string, type: string, role = "part", status = "ready") => ({ rel, part_number: pn, part_version: "003", part_name: "示例件", type_code: type, role, status } as GalleryRow);
it("uses compact category names without changing classification", () => {
  expect(category("H")).toBe("一般件");
  expect(category("S")).toBe("标准件");
  expect(category("R")).toBe("虚拟件");
  expect(category("")).toBe("其他 / 未分类");
});
it("filters entirely client-side and sorts category then natural part number", () => {
  const rows = [row("S", "2", "S"), row("H10", "10", "H"), row("H2", "2", "H"), row("Asm", "1", "H", "assembly"), row("Drawing", "0", "H", "drawing"), row("Missing", "20", "H", "part", "missing")];
  expect(visibleGalleryRows(rows, "", "", false, false).map(r => r.rel)).toEqual(["H2", "H10", "Missing", "S"]);
  expect(visibleGalleryRows(rows, "", "H", true, true).map(r => r.rel)).toEqual(["Missing"]);
  expect(visibleGalleryRows(rows, "h10", "", true, false).map(r => r.rel)).toEqual(["H10"]);
  expect(rows[0].rel).toBe("S");
});
it("formats model-axis bounding boxes in mm, never thumbnail pixels, with at most two decimals", () => {
  const part: GalleryRow = { ...row("Synthetic.FCStd", "1", "H"), width: 512, height: 256, bounding_box: { x_mm: 10, y_mm: 20.126, z_mm: 30.1 } };
  expect(boundingBoxText(part)).toBe("10 × 20.13 × 30.1 mm");
  expect(boundingBoxText({ ...part, bounding_box: null })).toBe("尺寸未获取");
  expect(boundingBoxText({ ...part, role: "assembly" } as GalleryRow)).toBe("10 × 20.13 × 30.1 mm");
  expect(boundingBoxTitle(part)).toContain("X / Y / Z");
  expect(boundingBoxTitle(part)).toContain("不是加工公差尺寸");
});
it("accepts planar and line extents and does not round positive small dimensions down to zero", () => {
  expect(boundingBoxText({ bounding_box: { x_mm: 10, y_mm: 20, z_mm: 0 } })).toBe("10 × 20 × 0 mm");
  expect(boundingBoxText({ bounding_box: { x_mm: 0, y_mm: 0.001, z_mm: 0 } })).toBe("0 × <0.01 × 0 mm");
  expect(boundingBoxText({ bounding_box: { x_mm: 100, y_mm: 200, z_mm: 300 } })).toBe("100 × 200 × 300 mm");
});
it("rejects absent, all-zero, negative and non-finite extents, and exposes measurement messages in the title", () => {
  expect(boundingBoxText({})).toBe("尺寸未获取");
  for (const bounding_box of [
    { x_mm: 0, y_mm: 0, z_mm: 0 },
    { x_mm: -1, y_mm: 2, z_mm: 3 },
    { x_mm: Number.NaN, y_mm: 2, z_mm: 3 },
    { x_mm: 1, y_mm: Number.POSITIVE_INFINITY, z_mm: 3 },
    { x_mm: 1, y_mm: 2, z_mm: Number.NEGATIVE_INFINITY },
  ]) expect(boundingBoxText({ bounding_box })).toBe("尺寸未获取");
  expect(boundingBoxTitle({ dimension_message: "总成暂不测量" })).toContain("总成暂不测量");
});
