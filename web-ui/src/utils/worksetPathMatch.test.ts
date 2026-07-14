import { describe, expect, it } from "vitest";
import { matchesWorksetPath } from "./worksetPathMatch";

describe("matchesWorksetPath", () => {
  it("matches files exactly and directories recursively", () => {
    const entries = [
      { path: "src/module", type: "dir" as const },
      { path: "README.md", type: "file" as const },
    ];

    expect(matchesWorksetPath("src/module/main.cpp", entries)).toBe(true);
    expect(matchesWorksetPath("src/module", entries)).toBe(true);
    expect(matchesWorksetPath("src/module-other/main.cpp", entries)).toBe(false);
    expect(matchesWorksetPath("README.md", entries)).toBe(true);
    expect(matchesWorksetPath("docs/README.md", entries)).toBe(false);
  });

  it("normalizes separators and treats legacy string entries as files", () => {
    expect(matchesWorksetPath("src\\main.cpp", ["src/main.cpp"])).toBe(true);
    expect(matchesWorksetPath("src/main.cpp/child", ["src/main.cpp"])).toBe(false);
  });
});
