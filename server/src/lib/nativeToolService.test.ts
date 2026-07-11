import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  nativeToolCandidates,
  nativeToolStatus,
  requireNativeTool,
  resolveNativeTool,
} from "./nativeToolService.js";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-tools-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("nativeToolService", () => {
  it("prefers an explicit environment override and reports both tools", () => {
    const root = tempRoot();
    const read = path.join(root, "custom-read.exe");
    const xlink = path.join(root, "custom-xlink.exe");
    fs.writeFileSync(read, "fixture");
    fs.writeFileSync(xlink, "fixture");
    const env = { PHOENIX_FCSTD_READ: read, PHOENIX_FCSTD_XLINK: xlink };

    expect(resolveNativeTool("fcstd-read", { env, platform: "win32", serverRoot: root })).toBe(read);
    expect(nativeToolStatus({ env, platform: "win32", serverRoot: root })).toMatchObject({
      ok: true,
      tools: [
        { name: "fcstd-read", available: true, path: read },
        { name: "fcstd-xlink", available: true, path: xlink },
      ],
    });
  });

  it("uses stable bin before Cargo outputs and gives an actionable missing error", () => {
    const root = tempRoot();
    const stable = path.join(root, "bin", "fcstd-read");
    const release = path.join(root, "cli", "target", "release", "fcstd-read");
    fs.mkdirSync(path.dirname(stable), { recursive: true });
    fs.mkdirSync(path.dirname(release), { recursive: true });
    fs.writeFileSync(stable, "stable");
    fs.writeFileSync(release, "release");

    const options = { env: {}, platform: "linux" as const, serverRoot: root };
    expect(nativeToolCandidates("fcstd-read", options).indexOf(stable))
      .toBeLessThan(nativeToolCandidates("fcstd-read", options).indexOf(release));
    expect(resolveNativeTool("fcstd-read", options)).toBe(stable);
    expect(() => requireNativeTool("fcstd-xlink", options)).toThrow(/pnpm build:native/);
  });
});
