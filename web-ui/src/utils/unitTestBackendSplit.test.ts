import { describe, it, expect } from "vitest";
import {
  mergeSuites,
  partitionSuiteIds,
  collectVitestModules,
  type SuiteInfo,
  type VitestModuleItem,
} from "./unitTestBackendSplit";

// ──────────────────────────────────────────────
// mergeSuites
// ──────────────────────────────────────────────

function makePySuite(overrides: Partial<SuiteInfo> = {}): SuiteInfo {
  return {
    id: "code",
    label: "Code",
    description: "code suite",
    module_count: 10,
    modules: ["tests.test_a", "tests.test_b"],
    backend: "python",
    ...overrides,
  };
}

function makeVitestModule(file: string, count = 3): VitestModuleItem {
  return { file, count, tests: ["test 1", "test 2", "test 3"].slice(0, count) };
}

describe("mergeSuites", () => {
  it("vitest 无数据时，保留 Python 的 vitest 套件", () => {
    const py = [
      makePySuite({ id: "code", backend: "python" }),
      { id: "caa", label: "CAA", description: "caa", module_count: 0, modules: [], backend: "vitest" as const },
    ];
    const result = mergeSuites(py, []);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["code", "caa"]);
  });

  it("vitest 有数据时，跳过 Python 的 vitest 套件，用 Node 数据替代", () => {
    const py = [
      makePySuite({ id: "code" }),
      { id: "caa", label: "CAA", description: "caa", module_count: 0, modules: [], backend: "vitest" as const },
    ];
    const vitestMods = [makeVitestModule("web-ui/src/a.test.ts"), makeVitestModule("web-ui/src/b.test.ts")];
    const result = mergeSuites(py, vitestMods);
    expect(result).toHaveLength(2);
    const caa = result.find((s) => s.id === "caa")!;
    expect(caa.module_count).toBe(2);
    expect(caa.modules).toEqual(["web-ui/src/a.test.ts", "web-ui/src/b.test.ts"]);
    expect(caa.backend).toBe("vitest");
    // Python 的 code 套件保留
    expect(result.find((s) => s.id === "code")).toBeTruthy();
  });

  it("仅 Python 套件，无 vitest", () => {
    const py = [makePySuite({ id: "code" }), makePySuite({ id: "cad" })];
    const result = mergeSuites(py, []);
    expect(result.map((s) => s.id)).toEqual(["code", "cad"]);
    expect(result.every((s) => s.backend === "python")).toBe(true);
  });

  it("仅 vitest 数据，无 Python vitest 套件重复", () => {
    const py = [makePySuite({ id: "platform" })];
    const vitestMods = [makeVitestModule("web-ui/src/x.test.ts", 5)];
    const result = mergeSuites(py, vitestMods);
    expect(result.map((s) => s.id)).toEqual(["platform", "caa"]);
    expect(result.find((s) => s.id === "caa")!.module_count).toBe(1);
  });
});

// ──────────────────────────────────────────────
// partitionSuiteIds
// ──────────────────────────────────────────────

describe("partitionSuiteIds", () => {
  const suites: SuiteInfo[] = [
    makePySuite({ id: "code", backend: "python" }),
    makePySuite({ id: "cad", backend: "python" }),
    { id: "caa", label: "CAA", description: "caa", module_count: 3, modules: ["a.ts"], backend: "vitest" },
    makePySuite({ id: "platform", backend: "python" }),
  ];

  it("全 Python 套件", () => {
    const { pyIds, vitestIds } = partitionSuiteIds(suites, ["code", "cad"]);
    expect(pyIds).toEqual(["code", "cad"]);
    expect(vitestIds).toEqual([]);
  });

  it("全 vitest 套件", () => {
    const { pyIds, vitestIds } = partitionSuiteIds(suites, ["caa"]);
    expect(pyIds).toEqual([]);
    expect(vitestIds).toEqual(["caa"]);
  });

  it("混合套件拆分", () => {
    const { pyIds, vitestIds } = partitionSuiteIds(suites, ["code", "caa", "cad"]);
    expect(pyIds).toEqual(["code", "cad"]);
    expect(vitestIds).toEqual(["caa"]);
  });

  it("未知套件归类到 Python", () => {
    const { pyIds, vitestIds } = partitionSuiteIds(suites, ["unknown"]);
    expect(pyIds).toEqual(["unknown"]);
    expect(vitestIds).toEqual([]);
  });

  it("空列表", () => {
    const { pyIds, vitestIds } = partitionSuiteIds(suites, []);
    expect(pyIds).toEqual([]);
    expect(vitestIds).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// collectVitestModules
// ──────────────────────────────────────────────

describe("collectVitestModules", () => {
  const suites: SuiteInfo[] = [
    { id: "caa", label: "CAA", description: "", module_count: 2, modules: ["a.test.ts", "b.test.ts"], backend: "vitest" },
    makePySuite({ id: "code", modules: ["tests.test_code"] }),
  ];

  it("收集 vitest 套件的模块", () => {
    const mods = collectVitestModules(suites, ["caa"]);
    expect(mods).toEqual(["a.test.ts", "b.test.ts"]);
  });

  it("空 vitest ID 返回空", () => {
    expect(collectVitestModules(suites, [])).toEqual([]);
  });

  it("不收集 Python 套件模块（即使 ID 在列表中）", () => {
    const mods = collectVitestModules(suites, ["caa", "code"]);
    expect(mods).toEqual(["a.test.ts", "b.test.ts"]);
  });
});
