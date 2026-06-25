/**
 * 预期输出测试：对 golden 文件执行删除/移动/新增操作，验证 emit 输出与预期一致。
 *
 * 生成文件（每操作目录）：
 *   ir-before.json    ← 解析 golden 后的 IR（共用）
 *   ir-after.json     ← 操作修改后的 IR
 *   nls-ordered.json  ← collectNlsOrdered 输出
 *   CATDlg / CATNls   ← emit 文本
 *
 * 首次运行：CAA_WRITE_EXPECTED=1 npx vitest run
 * 后续运行做 diff 比较。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeDialogIr } from "./mergeIr.js";
import { emitCatDlg, collectNlsOrdered } from "./emitCatDlg.js";
import { patchCatNls } from "./patchCatNls.js";
import type { CaaDialogNode } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "../../../tests/fixtures/caa");
const GOLDEN = resolve(FIXTURES, "golden");
const EXPECTED = resolve(FIXTURES, "expected");

const WRITE = process.env.CAA_WRITE_EXPECTED === "1";

function read(dir: string, name: string) {
  return readFileSync(resolve(dir, name), "utf8");
}
function writeJson(subdir: string, name: string, data: unknown) {
  const dir = resolve(EXPECTED, subdir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), JSON.stringify(data, null, 2), "utf8");
}
function writeText(subdir: string, name: string, content: string) {
  const dir = resolve(EXPECTED, subdir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), content, "utf8");
}

interface Operation {
  name: string;
  apply: (ir: ReturnType<typeof mergeDialogIr>) => void;
}

describe("PNXBomAnalysisDlg 预期输出", () => {
  const dlg = read(GOLDEN, "PNXBomAnalysisDlg.CATDlg");
  const nls = read(GOLDEN, "PNXBomAnalysisDlg.CATNls");

  // golden IR JSON（供查看 model 结构）
  const baseIr = mergeDialogIr({ catDlgText: dlg, catNlsText: nls, sources: { catDlg: "x", catNls: "x" } });
  if (WRITE) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(resolve(GOLDEN, "PNXBomAnalysisDlg.ir.json"), JSON.stringify({ root: baseIr.root, title: baseIr.title, dialogName: baseIr.dialogName }, null, 2), "utf8");
    writeFileSync(resolve(GOLDEN, "PNXBomAnalysisDlg.nls-ordered.json"), JSON.stringify(collectNlsOrdered(baseIr.root), null, 2), "utf8");
  }

  const operations: Operation[] = [
    {
      name: "delete-LabelFirstProduct",
      apply: (ir) => {
        const fp = ir.root.children.find((c) => c.id === "FrameParams")!;
        fp.children = fp.children.filter((c) => c.id !== "LabelFirstProduct");
      },
    },
    {
      name: "move-PushButtonJson-to-FrameParams",
      apply: (ir) => {
        const frameOutput = ir.root.children
          .find((c) => c.id === "FrameBom")!.children
          .find((c) => c.id === "FrameOutput")!;
        const frameParams = ir.root.children.find((c) => c.id === "FrameParams")!;
        const btn = frameOutput.children.find((c) => c.id === "PushButtonJson")!;
        frameOutput.children = frameOutput.children.filter((c) => c.id !== "PushButtonJson");
        btn.father = "FrameParams";
        btn.grid = { row: 0, col: 2, rowSpan: 1, colSpan: 1 };
        frameParams.children.push(btn);
      },
    },
    {
      name: "add-PushButton-to-FrameBom",
      apply: (ir) => {
        const fb = ir.root.children.find((c) => c.id === "FrameBom")!;
        fb.children.push({
          id: "PushButtonNew", type: "CATDlgPushButton", father: "FrameBom",
          grid: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
          nls: { title: "New Button" }, children: [],
        });
      },
    },
    {
      name: "delete-FrameBom-container",
      apply: (ir) => {
        ir.root.children = ir.root.children.filter((c) => c.id !== "FrameBom");
      },
    },
  ];

  for (const op of operations) {
    it(`${op.name}: CATDlg`, () => {
      const ir = mergeDialogIr({ catDlgText: dlg, catNlsText: nls, sources: { catDlg: "x", catNls: "x" } });
      op.apply(ir);
      const emitted = emitCatDlg(ir.root);

      if (WRITE) {
        writeText(`PNXBomAnalysisDlg/${op.name}`, "PNXBomAnalysisDlg.CATDlg", emitted);
        writeJson(`PNXBomAnalysisDlg/${op.name}`, "ir-after.json", { root: ir.root, title: ir.title, dialogName: ir.dialogName });
      }

      const expected = read(EXPECTED, `PNXBomAnalysisDlg/${op.name}/PNXBomAnalysisDlg.CATDlg`);
      expect(emitted).toBe(expected);
    });

    it(`${op.name}: CATNls`, () => {
      const ir = mergeDialogIr({ catDlgText: dlg, catNlsText: nls, sources: { catDlg: "x", catNls: "x" } });
      op.apply(ir);
      const ordered = collectNlsOrdered(ir.root);
      const patched = patchCatNls(nls, ordered);

      if (WRITE) {
        writeText(`PNXBomAnalysisDlg/${op.name}`, "PNXBomAnalysisDlg.CATNls", patched);
        writeJson(`PNXBomAnalysisDlg/${op.name}`, "nls-ordered.json", ordered);
      }

      const expected = read(EXPECTED, `PNXBomAnalysisDlg/${op.name}/PNXBomAnalysisDlg.CATNls`);
      expect(patched).toBe(expected);
    });
  }
});
