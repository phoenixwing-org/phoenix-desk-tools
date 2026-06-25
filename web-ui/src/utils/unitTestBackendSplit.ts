/**
 * 前后端分离辅助：按 backend 拆合套件、拆分运行目标。
 * 纯函数，可单测。
 */

export interface SuiteInfo {
  id: string;
  label: string;
  description: string;
  module_count: number;
  modules: string[];
  backend: "python" | "vitest";
}

export interface VitestModuleItem {
  file: string;
  count: number;
  tests: string[];
}

/**
 * 合并 Python 套件 + Node vitest 模块列表。
 * vitest 有数据时跳过 Python 端的 vitest 套件（以 Node 实时数据为准）。
 */
export function mergeSuites(
  pySuites: SuiteInfo[],
  vitestModules: VitestModuleItem[],
): SuiteInfo[] {
  const result: SuiteInfo[] = [];
  const hasVitest = vitestModules.length > 0;

  for (const s of pySuites) {
    if (hasVitest && s.backend === "vitest") continue;
    result.push(s);
  }

  if (hasVitest) {
    result.push({
      id: "caa",
      label: "CAA 模块",
      description: "对话框编辑器：解析/emit/拖放/NLS/保存（vitest）",
      module_count: vitestModules.length,
      modules: vitestModules.map((m) => m.file),
      backend: "vitest",
    });
  }

  return result;
}

/**
 * 按 backend 拆分 suite ID 列表。
 */
export function partitionSuiteIds(
  suites: SuiteInfo[],
  suiteIds: string[],
): { pyIds: string[]; vitestIds: string[] } {
  const backendMap = new Map(suites.map((s) => [s.id, s.backend]));
  const pyIds: string[] = [];
  const vitestIds: string[] = [];

  for (const id of suiteIds) {
    if (backendMap.get(id) === "vitest") {
      vitestIds.push(id);
    } else {
      pyIds.push(id);
    }
  }

  return { pyIds, vitestIds };
}

/**
 * 收集 vitest 套件的所有模块名。
 */
export function collectVitestModules(
  suites: SuiteInfo[],
  vitestIds: string[],
): string[] {
  const vitestIdSet = new Set(vitestIds);
  const modules: string[] = [];
  for (const s of suites) {
    if (s.backend === "vitest" && vitestIdSet.has(s.id)) {
      modules.push(...s.modules);
    }
  }
  return modules;
}
