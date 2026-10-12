import { describe, expect, it, vi } from "vitest";
import { galleryBoundingBoxText, galleryCategory, galleryDocument } from "./document.js";
import type { GalleryRow } from "./types.js";

function row(index = 1, overrides: Partial<GalleryRow> = {}): GalleryRow {
  return {
    rel: `samples/Part-${index}.FCStd`, part_number: `DEMO-${index}`, part_version: "A", part_name: "合成连接板", type_code: "H",
    role: "part", status: "ready", width: 512, height: 256, image_hash: "synthetic", source_stamp: "synthetic", source_hash: "synthetic",
    updated_at: "2026-01-01T00:00:00Z", message: "", refs: [], bounding_box: { x_mm: 12.5, y_mm: 4.25, z_mm: 2 }, ...overrides,
  };
}
const image = () => "data:image/png;base64,c3ludGhldGlj";
const render = (rows: GalleryRow[], options?: Parameters<typeof galleryDocument>[4]) => galleryDocument(rows, "独立合成产品", "2026-01-01T00:00:00Z", image, options);

describe("compact A4 gallery documents", () => {
  it("puts twenty cards on each four-column, five-row A4 page", () => {
    const html = render(Array.from({ length: 21 }, (_, index) => row(index + 1)));
    const pages = html.split('<section class="sheet">').slice(1);
    expect(pages).toHaveLength(2);
    expect(pages[0].match(/<article class="card">/g)).toHaveLength(20);
    expect(pages[1].match(/<article class="card">/g)).toHaveLength(1);
    expect(html).toContain("grid-template-columns:repeat(4,minmax(0,1fr))");
    expect(html).toContain("grid-template-rows:repeat(5,48mm)");
    expect(html).toContain("height:32mm");
    expect(html).toContain("size:A4 portrait");
    expect(html).toContain("<span>2 / 2</span>");
  });

  it("overlays category and real model dimensions without adding a metadata row", () => {
    const html = render([row(1, { role: "assembly" })]);
    expect(galleryCategory("H")).toBe("一般件");
    expect(html).toContain('<div class="image"><div class="badges"><span>一般件</span><span>总成</span></div><img');
    expect(html).toContain("12.5 × 4.25 × 2 mm</div></div><div class=\"identity\">");
    expect(html).toContain("非图片像素或加工公差尺寸");
    expect(html).not.toContain("512 × 256");
    expect(html).not.toContain('class="meta"');
    expect(html).toContain("top:1mm;left:1mm");
    expect(html).toContain("right:1mm;bottom:1mm");
    expect(galleryBoundingBoxText(row(1, { bounding_box: null }))).toBe("尺寸未获取");
  });

  it("defaults the three metadata switches on and filenames off", () => {
    const html = render([row()]);
    expect(html).toContain('class="badges"');
    expect(html).toContain('class="dimensions"');
    expect(html).toContain('<span class="number">DEMO-1.A</span>');
    expect(html).not.toContain('class="file"');
    const hidden = render([row()], { showCategory: false, showDimensions: false, showPartNumber: false });
    expect(hidden).not.toContain('class="badges"');
    expect(hidden).not.toContain('class="dimensions"');
    expect(hidden).not.toContain('class="number"');
    expect(hidden).toContain('<span class="name">合成连接板</span>');
  });

  it("shows only escaped basenames on demand and keeps the complete filename in its title", () => {
    const filename = 'Demo-<&"\'name>.FCStd';
    const item = row(1, { rel: `synthetic-folder/${filename}` });
    const html = render([item], { showFilenames: true });
    const escaped = "Demo-&lt;&amp;&quot;&#39;name&gt;.FCStd";
    expect(html).toContain(`<div class="file" title="${escaped}">${escaped}</div>`);
    expect(html).not.toContain("synthetic-folder/");
    expect(render([item])).not.toContain(escaped);
    expect(html).toContain("text-overflow:ellipsis");
  });

  it("preserves complete labels and remains escaped and script-free", () => {
    const malicious = '<script>alert("synthetic")</script>&';
    const html = render([row(1, { part_name: malicious, part_number: '<DEMO"', part_version: "'A" })]);
    expect(html).toContain('&lt;script&gt;alert(&quot;synthetic&quot;)&lt;/script&gt;&amp;');
    expect(html).toContain('&lt;DEMO&quot;.&#39;A');
    expect(html).not.toContain("<script>");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("display:flex;flex-wrap:wrap;align-items:baseline");
    expect(html).not.toContain("line-clamp");
    expect(html).not.toContain(".name{overflow:hidden");
  });

  it("fits the A4 height budget and three ordinary identity lines plus a filename", () => {
    const longName = "独立合成的通用连接支撑板用于演示长名称换行与紧凑图册布局";
    const html = render([row(1, { part_name: longName })], { showFilenames: true });
    expect(html).toContain(`<span class="name">${longName}</span>`);
    // No CAD or browser state is needed: verify the declared physical page/card budget.
    const mmPerPx = 25.4 / 96;
    expect(19 + 3 + 5 * 48 + 4 * 2 + 7).toBe(297 - 2 * 10);
    const cardInnerHeight = 48 - 2 * 1.2 - 2 * mmPerPx;
    const contentsHeight = 32 + .6 + 3 * 11 * 1.1 * mmPerPx + .3 + 8 * 1.1 * mmPerPx;
    expect(contentsHeight).toBeLessThan(cardInnerHeight);
  });

  it("does not request images for unavailable rows and retains an empty page", () => {
    const callback = vi.fn(image);
    const html = galleryDocument([row(1, { status: "missing" })], "", "2026-01-01", callback);
    expect(callback).not.toHaveBeenCalled();
    expect(html).toContain('class="placeholder">缺少缩略图');
    expect(render([]).match(/class="sheet"/g)).toHaveLength(1);
  });
});
