import { describe, expect, it } from "vitest";
import { patchCatNls } from "./patchCatNls.js";

const SAMPLE = `// header
// DO NOT EDIT :: THE CAA2 WIZARD WILL REPLACE ALL THE CODE HERE
Title = "PNX Curve Division";
FrameParams.LabelBaseCurve.Title = "Base Curve";
// END WIZARD REPLACEMENT ZONE
`;

const SAMPLE_OUTSIDE = `// custom header
OutsideKey.Title = "Outside";
// DO NOT EDIT :: THE CAA2 WIZARD WILL REPLACE ALL THE CODE HERE
Title = "Dialog Title";
Frame1.LabelA.Title = "Inside A";
// END WIZARD REPLACEMENT ZONE
OutsideFooter.Title = "Footer";
`;

const SAMPLE_NO_WIZARD = `// plain file
Title = "Old Title";
Old.Key = "Old";
`;

function e(key: string, value: string) {
  return { key, value };
}

describe("patchCatNls (WIZARD zone full rewrite)", () => {
  it("更新已有 key 并保留 header", () => {
    const out = patchCatNls(SAMPLE, [
      e("Title", "PNX Curve Division 2"),
      e("FrameParams.LabelBaseCurve.Title", "Base Curve"),
    ]);
    expect(out).toContain("Title = \"PNX Curve Division 2\";");
    expect(out).toContain("// header");
    expect(out).toContain("END WIZARD");
  });

  it("新增 key 应插入 WIZARD 区（保持传入顺序）", () => {
    const out = patchCatNls(SAMPLE, [
      e("Title", "PNX Curve Division"),
      e("FrameParams.LabelBaseCurve.Title", "Base Curve"),
      e("FrameParams.LabelPointCount.Title", "Point Count"),
    ]);
    // 检查三个 key 的相对位置
    const titleIdx = out.indexOf("Title =");
    const baseIdx = out.indexOf("FrameParams.LabelBaseCurve.Title");
    const pointIdx = out.indexOf("FrameParams.LabelPointCount.Title");
    expect(titleIdx).toBeLessThan(baseIdx);
    expect(baseIdx).toBeLessThan(pointIdx);
  });

  // ── 删除残留 ──

  it("不在 entries 中的 key 自动删除", () => {
    const out = patchCatNls(SAMPLE, [
      e("Title", "Only Title"),
    ]);
    expect(out).toContain("Title = \"Only Title\";");
    expect(out).not.toContain("LabelBaseCurve");
    expect(out).toContain("END WIZARD");
  });

  // ── WIZARD 区外保留 ──

  it("WIZARD 区外 key 原样保留", () => {
    const out = patchCatNls(SAMPLE_OUTSIDE, [
      e("Title", "Dialog Title Updated"),
      e("Frame1.LabelA.Title", "Inside A"),
    ]);
    expect(out).toContain("OutsideKey.Title = \"Outside\";");
    expect(out).toContain("OutsideFooter.Title = \"Footer\";");
    expect(out).toContain("Title = \"Dialog Title Updated\";");
  });

  it("WIZARD 区外 key 不受 entries 影响", () => {
    // entries 不含 OutsideKey → WIZARD 外的不动
    const out = patchCatNls(SAMPLE_OUTSIDE, [
      e("Title", "Dialog Title"),
    ]);
    expect(out).toContain("OutsideKey.Title = \"Outside\";");
  });

  // ── 无 WIZARD 标记 ──

  it("源文件无 WIZARD 标记时在末尾追加", () => {
    const out = patchCatNls(SAMPLE_NO_WIZARD, [
      e("Title", "New Title"),
      e("New.Key", "New"),
    ]);
    expect(out).toContain("// plain file");
    expect(out).toContain("Title = \"Old Title\";");
    expect(out).toContain("Old.Key = \"Old\";");
    // WIZARD 标记 + 新 entries 应在末尾
    expect(out).toContain("DO NOT EDIT");
    expect(out).toContain("Title = \"New Title\";");
    expect(out).toContain("New.Key = \"New\";");
    expect(out).toContain("END WIZARD");
  });

  // ── entry 顺序保留 ──

  it("entries 顺序即输出顺序", () => {
    const out = patchCatNls(SAMPLE, [
      e("FrameParams.ZZZ.Title", "Z"),
      e("FrameParams.AAA.Title", "A"),
      e("Title", "T"),
    ]);
    const zIdx = out.indexOf("ZZZ");
    const aIdx = out.indexOf("AAA");
    const tIdx = out.indexOf("\"T\"");
    expect(zIdx).toBeLessThan(aIdx);
    expect(aIdx).toBeLessThan(tIdx);
  });
});
