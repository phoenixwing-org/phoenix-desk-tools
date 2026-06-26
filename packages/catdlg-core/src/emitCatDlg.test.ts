import { describe, it, expect } from "vitest";
import { emitCatDlg, collectNlsFlat, emitCatDlgText, validateCaaDialogIrRoot } from "./emitCatDlg.js";
import { parseCatDlg } from "./parseCatDlg.js";
import type { CaaDialogNode } from "./schema.js";

// ═══════════════════════════════════════════════════════════════════
// Shared fixtures
// ═══════════════════════════════════════════════════════════════════

function makeRoot(): CaaDialogNode {
  return {
    id: "TestDlg",
    type: "CATDlgDialog",
    style: ["CATDlgWndBtnOKCancel", "CATDlgGridLayout"],
    gridLayout: { rowResizable: [1], colResizable: [0] },
    children: [
      {
        id: "Frame1",
        type: "CATDlgFrame",
        father: "TestDlg",
        style: ["CATDlgFraNoFrame", "CATDlgGridLayout"],
        grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        gridLayout: { colResizable: [0] },
        children: [
          {
            id: "Label1",
            type: "CATDlgLabel",
            father: "Frame1",
            grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
            nls: { title: "Hello" },
            children: [],
          },
          {
            id: "Editor1",
            type: "CATDlgEditor",
            father: "Frame1",
            style: ["CATDlgWndNone"],
            grid: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
            size: { textHeight: 1, textWidth: 20 },
            nls: { title: "Input" },
            children: [],
          },
        ],
      },
    ],
  };
}

const SARIKO_ROOT: CaaDialogNode = {
  id: "MyDlg",
  type: "CATDlgDialog",
  style: ["CATDlgWndBtn"],
  children: [
    {
      id: "FrameParams",
      type: "CATDlgFrame",
      father: "MyDlg",
      grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
      children: [
        {
          id: "LabelName",
          type: "CATDlgLabel",
          father: "FrameParams",
          grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
          nls: { title: "Name" },
          children: [],
        },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// emitCatDlg (Sam) — 按原始属性顺序 emit + round-trip
// ═══════════════════════════════════════════════════════════════════

describe("emitCatDlg", () => {
  it("属性顺序应为 FATHER→STYLE→size→GRID→ROWRES/COLRES", () => {
    const out = emitCatDlg(makeRoot());
    // 验证 Dialog root：STYLE → ROWRES → COLRES（无 FATHER/GRID）
    const dlgBlock = out.split("CATDlgFrame")[0];
    const styleIdx = dlgBlock.indexOf("STYLE =");
    const rowresIdx = dlgBlock.indexOf("ROWRES =");
    const colresIdx = dlgBlock.indexOf("COLRES =");
    expect(styleIdx).toBeLessThan(rowresIdx);
    expect(rowresIdx).toBeLessThan(colresIdx);

    // 验证 Frame：FATHER → STYLE → GRID → COLRES
    const frameBlock = out.substring(out.indexOf("CATDlgFrame"));
    const fatherIdx = frameBlock.indexOf("FATHER =");
    const fstyleIdx = frameBlock.indexOf("STYLE =");
    const gridIdx = frameBlock.indexOf("GRID =");
    const fcolresIdx = frameBlock.indexOf("COLRES =");
    expect(fatherIdx).toBeLessThan(fstyleIdx);
    expect(fstyleIdx).toBeLessThan(gridIdx);
    expect(gridIdx).toBeLessThan(fcolresIdx);
  });

  it("应包含 Dialog 声明和 ROWRES/COLRES", () => {
    const out = emitCatDlg(makeRoot());
    expect(out).toContain("CATDlgDialog TestDlg");
    expect(out).toContain("ROWRES = { 1 };");
    expect(out).toContain("COLRES = { 0 };");
  });

  it("应包含 STYLE", () => {
    const out = emitCatDlg(makeRoot());
    expect(out).toContain("STYLE = CATDlgWndBtnOKCancel|CATDlgGridLayout;");
  });

  it("应包含子 Frame + GRID", () => {
    const out = emitCatDlg(makeRoot());
    expect(out).toContain("CATDlgFrame Frame1");
    expect(out).toContain("FATHER = TestDlg;");
    expect(out).toContain("GRID = { 0, 0, 1, 1, CATGRID_4SIDES };");
  });

  it("应包含孙节点 Editor + TH/TW", () => {
    const out = emitCatDlg(makeRoot());
    expect(out).toContain("CATDlgEditor Editor1");
    expect(out).toContain("FATHER = Frame1;");
    expect(out).toContain("TH = 1;");
    expect(out).toContain("TW = 20;");
  });

  it("round-trip: emit → parse → 结构一致", () => {
    const root = makeRoot();
    const emitted = emitCatDlg(root);
    const parsed = parseCatDlg(emitted);

    // 所有节点都存在
    const ids = parsed.map((n: { id: string }) => n.id);
    expect(ids).toContain("TestDlg");
    expect(ids).toContain("Frame1");
    expect(ids).toContain("Label1");
    expect(ids).toContain("Editor1");

    // Label1 有 FATHER
    const label1 = parsed.find((n: { id: string }) => n.id === "Label1");
    expect(label1.properties.FATHER).toBe("Frame1");

    // Editor1 有 TH/TW
    const editor1 = parsed.find((n: { id: string }) => n.id === "Editor1");
    expect(editor1.properties.TH).toBe(1);
    expect(editor1.properties.TW).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════
// collectNlsFlat (Sam)
// ═══════════════════════════════════════════════════════════════════

describe("collectNlsFlat", () => {
  it("应收集所有 NLS 键", () => {
    const root = makeRoot();
    root.nls = { title: "My Dialog" };
    const flat = collectNlsFlat(root);

    expect(flat["Title"]).toBe("My Dialog");
    expect(flat["Frame1.Label1.Title"]).toBe("Hello");
    expect(flat["Frame1.Editor1.Title"]).toBe("Input");
  });

  it("应收集 columnTitles", () => {
    const root = makeRoot();
    root.children[0].nls = { columnTitles: ["A", "B"] };
    const flat = collectNlsFlat(root);
    expect(flat["Frame1.ColumnTitle1"]).toBe("A");
    expect(flat["Frame1.ColumnTitle2"]).toBe("B");
  });

  it("无 nls 的节点不产生任何 key", () => {
    const root = makeRoot();
    root.children[0].nls = undefined;
    const leaf = root.children[0].children[0];
    leaf.nls = undefined;
    const flat = collectNlsFlat(root);
    // Frame1 有 nls 的子节点 Editor1 仍有 key
    expect(flat["Frame1.Editor1.Title"]).toBe("Input");
    // 但 Label1 无 nls → 无 key
    expect(flat["Frame1.Label1.Title"]).toBeUndefined();
  });

  it("删除节点后对应 key 消失", () => {
    const root = makeRoot();
    // 删除 Label1
    root.children[0].children = root.children[0].children.filter(c => c.id !== "Label1");
    const flat = collectNlsFlat(root);
    expect(flat["Frame1.Label1.Title"]).toBeUndefined();
    expect(flat["Frame1.Editor1.Title"]).toBe("Input");
  });

  it("新增节点产生新 key", () => {
    const root = makeRoot();
    root.children[0].children.push({
      id: "Btn1", type: "CATDlgPushButton", father: "Frame1",
      grid: { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
      nls: { title: "OK" }, children: [],
    });
    const flat = collectNlsFlat(root);
    expect(flat["Frame1.Btn1.Title"]).toBe("OK");
  });

  it("移动节点后 key 前缀跟随 father 变化", () => {
    const root = makeRoot();
    // Frame1 → 新增子 Frame Frame2，把 Label1 移到 Frame2
    root.children[0].children.push({
      id: "Frame2", type: "CATDlgFrame", father: "Frame1",
      grid: { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
      children: [],
    });
    const label1 = root.children[0].children.find(c => c.id === "Label1")!;
    label1.father = "Frame2";
    root.children[0].children = root.children[0].children.filter(c => c.id !== "Label1");
    root.children[0].children.find(c => c.id === "Frame2")!.children.push(label1);

    const flat = collectNlsFlat(root);
    // 旧 key 消失
    expect(flat["Frame1.Label1.Title"]).toBeUndefined();
    // 新 key 出现
    expect(flat["Frame1.Frame2.Label1.Title"]).toBe("Hello");
  });

  it("空 title 仍保留 key", () => {
    const root = makeRoot();
    root.children[0].children[0].nls = { title: "" };
    const flat = collectNlsFlat(root);
    expect(flat["Frame1.Label1.Title"]).toBe("");
  });

  it("Help/ShortHelp/LongHelp 均收集", () => {
    const root = makeRoot();
    root.children[0].children[0].nls = { title: "X", help: "H", shortHelp: "SH", longHelp: "LH" };
    const flat = collectNlsFlat(root);
    expect(flat["Frame1.Label1.Help"]).toBe("H");
    expect(flat["Frame1.Label1.ShortHelp"]).toBe("SH");
    expect(flat["Frame1.Label1.LongHelp"]).toBe("LH");
  });
});

// ═══════════════════════════════════════════════════════════════════
// emitCatDlgText (Sariko)
// ═══════════════════════════════════════════════════════════════════

describe("emitCatDlgText", () => {
  it("emits declaration order, father, style, and grid fields", () => {
    expect(emitCatDlgText(SARIKO_ROOT)).toContain(
      [
        "CATDlgFrame FrameParams",
        "{",
        "  FATHER = MyDlg;",
        "  GRID = { 0, 0, 1, 1 };",
        "}",
      ].join("\n"),
    );
    expect(emitCatDlgText(SARIKO_ROOT)).toContain("CATDlgLabel LabelName");
  });
});

// ═══════════════════════════════════════════════════════════════════
// validateCaaDialogIrRoot (Sariko)
// ═══════════════════════════════════════════════════════════════════

describe("validateCaaDialogIrRoot", () => {
  it("accepts a valid dialog tree", () => {
    expect(validateCaaDialogIrRoot(SARIKO_ROOT)).toEqual({ errors: [], warnings: [] });
  });

  it("rejects duplicate ids, invalid fathers, and grid overlaps", () => {
    const invalid: CaaDialogNode = {
      id: "MyDlg",
      type: "CATDlgDialog",
      children: [
        {
          id: "A",
          type: "CATDlgLabel",
          father: "WrongFather",
          grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
          children: [],
        },
        {
          id: "A",
          type: "CATDlgEditor",
          father: "MyDlg",
          grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
          children: [],
        },
      ],
    };

    const result = validateCaaDialogIrRoot(invalid);
    expect(result.errors).toContain("A.FATHER=WrongFather 与父节点 MyDlg 不一致");
    expect(result.errors).toContain("重复控件 id：A");
    expect(result.errors).toContain("MyDlg 内控件重叠：A 与 A");
  });

  it("warns about unknown control types without blocking write", () => {
    const root: CaaDialogNode = {
      id: "MyDlg",
      type: "CATDlgDialog",
      children: [
        {
          id: "Mystery",
          type: "CATDlgMystery",
          father: "MyDlg",
          children: [],
        },
      ],
    };

    expect(validateCaaDialogIrRoot(root)).toEqual({
      errors: [],
      warnings: ["未登记控件类型：CATDlgMystery (Mystery)"],
    });
  });
});
