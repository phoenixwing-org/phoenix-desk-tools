import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it, vi } from "vitest";
import PrimaryThumbnail from "./PrimaryThumbnail.vue";
it("shows a compact no-thumbnail label without a broken image or empty frame", async () => {
  const html = await renderToString(createSSRApp(PrimaryThumbnail, { image: { src: "", alt: "No saved preview" } }));
  expect(html).toContain("无缩略图"); expect(html).not.toContain("<img");
});
it("keeps a valid saved image and its accessible description", async () => {
  const html = await renderToString(createSSRApp(PrimaryThumbnail, { image: { src: "data:image/png;base64,AA==", alt: "Demo thumbnail" } }));
  expect(html).toContain('alt="Demo thumbnail"'); expect(html).toContain("文件缩略图");
});
it("offers single-file generation even when the saved image is missing", async () => {
  const html = await renderToString(createSSRApp(PrimaryThumbnail, { image: { src: "", alt: "No image" }, generation: {
    options: { color: "original", axonometric: true, fit: true }, busy: false, disabled: false, message: "", error: false,
    update: vi.fn(), run: vi.fn(async () => {}),
  } }));
  for (const label of ["重新生成缩略图", "模型原色", "统一浅灰", "轴测图", "Fit", "备份并写入 FCStd 缩略图，不改模型"]) expect(html).toContain(label);
});
