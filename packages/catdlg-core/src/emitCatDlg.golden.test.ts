/**
 * Golden 测试：基于 tests/fixtures/caa/golden/ 中的真实 PNXBomAnalysis 文件。
 *
 * 流程：parse golden 文件 → model 操作 → emit → 验证
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeDialogIr } from "./mergeIr.js";
import { emitCatDlg, collectNlsOrdered } from "./emitCatDlg.js";
import { patchCatNls } from "./patchCatNls.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = resolve(__dirname, "../../../tests/fixtures/caa/golden");

function readFixture(name: string): string {
  return readFileSync(resolve(GOLDEN, name), "utf8");
}

describe("PNXBomAnalysisDlg golden CATDlg", () => {
  const dlgText = readFixture("PNXBomAnalysisDlg.CATDlg");

  it("parse → emit → reparse 所有节点保留", () => {
    const ir = mergeDialogIr({
      catDlgText: dlgText,
      sources: { catDlg: "PNXBomAnalysisDlg.CATDlg" },
    });

    const emitted = emitCatDlg(ir.root);
    const reparsed = mergeDialogIr({
      catDlgText: emitted,
      sources: { catDlg: "test" },
    });

    // 递归找节点
    const findNode = (root: typeof ir.root, id: string): typeof root | null => {
      if (root.id === id) return root;
      for (const c of root.children) {
        const found = findNode(c, id);
        if (found) return found;
      }
      return null;
    };

    const expectedIds = [
      "PNXBomAnalysisDlg", "FrameParams",
      "LabelFirstProduct", "SelectorListFirstProduct",
      "EditorFirstPartNumber", "LabelFirstPartNumber",
      "FrameBom", "MultiListPartBom", "FrameOutput",
      "PushButtonJson", "PushButtonPrintMarkdown", "EditorOutInfo",
    ];
    for (const id of expectedIds) {
      expect(findNode(reparsed.root, id)).not.toBeNull();
    }

    // 验证关键 FATHER 关系
    expect(findNode(reparsed.root, "FrameBom")!.father).toBe("PNXBomAnalysisDlg");
    expect(findNode(reparsed.root, "FrameOutput")!.father).toBe("FrameBom");
    expect(findNode(reparsed.root, "LabelFirstProduct")!.father).toBe("FrameParams");
  });

  it("属性顺序: FATHER→STYLE→size→GRID→ROWRES/COLRES", () => {
    const ir = mergeDialogIr({
      catDlgText: dlgText,
      sources: { catDlg: "x" },
    });
    const emitted = emitCatDlg(ir.root);

    // Dialog root：STYLE → ROWRES → COLRES（无 FATHER/GRID）
    const dlgBlock = emitted.substring(0, emitted.indexOf("CATDlgFrame"));
    const styleI = dlgBlock.indexOf("STYLE =");
    const rowI = dlgBlock.indexOf("ROWRES =");
    const colI = dlgBlock.indexOf("COLRES =");
    expect(styleI).toBeGreaterThan(0);
    expect(styleI).toBeLessThan(rowI);
    expect(rowI).toBeLessThan(colI);

    // FrameBom：FATHER→STYLE→GRID→ROWRES→COLRES
    const fbStart = emitted.indexOf("CATDlgFrame FrameBom");
    const fbEnd = emitted.indexOf("CATDlgFrame", fbStart + 1);
    const fbBlock = fbEnd > 0 ? emitted.substring(fbStart, fbEnd) : emitted.substring(fbStart);
    const fatherI = fbBlock.indexOf("FATHER =");
    const fbStyleI = fbBlock.indexOf("STYLE =");
    const gridI = fbBlock.indexOf("GRID =");
    const fbRowI = fbBlock.indexOf("ROWRES =");
    expect(fatherI).toBeLessThan(fbStyleI);
    expect(fbStyleI).toBeLessThan(gridI);
    expect(gridI).toBeLessThan(fbRowI);
  });
});

describe("PNXBomAnalysisDlg golden CATNls", () => {
  const dlgText = readFixture("PNXBomAnalysisDlg.CATDlg");
  const nlsText = readFixture("PNXBomAnalysisDlg.CATNls");

  it("NLS 有序输出 DFS grid 排序", () => {
    const ir = mergeDialogIr({
      catDlgText: dlgText,
      catNlsText: nlsText,
      sources: { catDlg: "x", catNls: "x" },
    });
    const ordered = collectNlsOrdered(ir.root);
    const keys = ordered.map((e) => e.key);

    // Root Title 最先
    expect(keys[0]).toBe("Title");

    // 同一容器内，grid row 小的先出现
    const frameParamsIdx = keys.findIndex((k) => k.startsWith("FrameParams."));
    const frameBomIdx = keys.findIndex((k) => k.startsWith("FrameBom."));
    // FrameParams (0,0) 应在 FrameBom (1,0) 之前
    expect(frameParamsIdx).toBeGreaterThan(0);
    expect(frameBomIdx).toBeGreaterThan(0);
    expect(frameParamsIdx).toBeLessThan(frameBomIdx);
  });

  it("删除控件后 NLS 无残留", () => {
    const ir = mergeDialogIr({
      catDlgText: dlgText,
      catNlsText: nlsText,
      sources: { catDlg: "x", catNls: "x" },
    });
    // 删除 LabelFirstProduct（FrameParams 的子节点）
    const frameParams = ir.root.children.find((c) => c.id === "FrameParams")!;
    frameParams.children = frameParams.children.filter((c) => c.id !== "LabelFirstProduct");

    const ordered = collectNlsOrdered(ir.root);
    const keys = ordered.map((e) => e.key);
    expect(keys.some((k) => k.includes("LabelFirstProduct"))).toBe(false);
  });

  it("patchCatNls WIZARD zone 完整重写 + 删除残留", () => {
    const ir = mergeDialogIr({
      catDlgText: dlgText,
      catNlsText: nlsText,
      sources: { catDlg: "x", catNls: "x" },
    });
    // 删除 LabelFirstProduct
    const frameParams = ir.root.children.find((c) => c.id === "FrameParams")!;
    frameParams.children = frameParams.children.filter((c) => c.id !== "LabelFirstProduct");

    const ordered = collectNlsOrdered(ir.root);
    const patched = patchCatNls(nlsText, ordered);

    // 不应包含被删控件
    expect(patched).not.toContain("LabelFirstProduct");
    // 其他 NLS 条目存在
    expect(patched).toContain("SelectorListFirstProduct");
    // WIZARD 标记存在
    expect(patched).toContain("DO NOT EDIT");
    expect(patched).toContain("END WIZARD");
    // header 注释保留
    expect(patched).toContain("@copyright");
  });
});
