import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const oldRead = process.env.PHOENIX_FCSTD_READ;
const oldXlink = process.env.PHOENIX_FCSTD_XLINK;
const oldQuery = process.env.PHOENIX_FCSTD_QUERY;
const roots: string[] = [];

afterEach(() => {
  if (oldRead == null) delete process.env.PHOENIX_FCSTD_READ;
  else process.env.PHOENIX_FCSTD_READ = oldRead;
  if (oldXlink == null) delete process.env.PHOENIX_FCSTD_XLINK;
  else process.env.PHOENIX_FCSTD_XLINK = oldXlink;
  if (oldQuery == null) delete process.env.PHOENIX_FCSTD_QUERY;
  else process.env.PHOENIX_FCSTD_QUERY = oldQuery;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

describe("shell native tool status", () => {
  it("reports resolved native executables through the frontend route", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shell-native-tools-"));
    roots.push(root);
    const read = path.join(root, "fcstd-read.exe");
    const xlink = path.join(root, "fcstd-xlink.exe");
    const query = path.join(root, "fcstd-query.exe");
    fs.writeFileSync(read, "fixture");
    fs.writeFileSync(xlink, "fixture");
    fs.writeFileSync(query, "fixture");
    process.env.PHOENIX_FCSTD_READ = read;
    process.env.PHOENIX_FCSTD_XLINK = xlink;
    process.env.PHOENIX_FCSTD_QUERY = query;
    vi.resetModules();
    const { shellRoutes } = await import("./shell.js");

    const response = await shellRoutes.request("/api/native-tools/status");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tools: [
        { name: "fcstd-read", available: true, path: read },
        { name: "fcstd-xlink", available: true, path: xlink },
        { name: "fcstd-query", available: true, path: query },
      ],
    });
  });
});
