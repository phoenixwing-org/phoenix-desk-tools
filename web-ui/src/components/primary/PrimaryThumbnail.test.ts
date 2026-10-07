import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import PrimaryThumbnail from "./PrimaryThumbnail.vue";
it("shows a compact no-thumbnail label without a broken image or empty frame", async () => {
  const html = await renderToString(createSSRApp(PrimaryThumbnail, { image: { src: "", alt: "No saved preview" } }));
  expect(html).toContain("无缩略图"); expect(html).not.toContain("<img");
});
it("keeps a valid saved image and its accessible description", async () => {
  const html = await renderToString(createSSRApp(PrimaryThumbnail, { image: { src: "data:image/png;base64,AA==", alt: "Demo thumbnail" } }));
  expect(html).toContain('alt="Demo thumbnail"'); expect(html).toContain("文件缩略图");
});
