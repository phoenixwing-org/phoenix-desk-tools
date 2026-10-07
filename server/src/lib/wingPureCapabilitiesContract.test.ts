import { describe, expect, it } from "vitest";
import fixture from "@phoenix-wing/code-core/fixtures/pure-capabilities-v1.json" with { type: "json" };
import {
  pnwMatchesWorkspacePath,
  pnwNormalizeWorkspacePath,
  pnwRelativeToWorkspaceRoots,
} from "@phoenix-wing/code-core";
import { normalizeWorksetEntries } from "./fileWorksetService.js";

describe("Wing workspace path Registry 契约", () => {
  it("workspace path 规范、匹配与相对根由 Wing 唯一实现", () => {
    for (const item of fixture.workspacePath.normalizeCases) {
      expect(pnwNormalizeWorkspacePath(item.input)).toBe(item.expected);
    }
    for (const item of fixture.workspacePath.matchCases) {
      expect(pnwMatchesWorkspacePath(
        item.candidate,
        item.entries as Parameters<typeof pnwMatchesWorkspacePath>[1],
      )).toBe(item.expected);
    }
    for (const item of fixture.workspacePath.relativeCases) {
      expect(pnwRelativeToWorkspaceRoots(item.candidate, item.roots))
        .toBe("expected" in item ? item.expected : undefined);
    }
    expect(normalizeWorksetEntries([
      { path: fixture.workspacePath.normalizeCases[0].input, type: "file" },
      { path: "src/../outside.cpp", type: "file" },
    ])).toEqual([{ path: "src/module/a.cpp", type: "file" }]);
  });
});
