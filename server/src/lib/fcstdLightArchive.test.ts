import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FCSTD_LIGHT_XML_BYTES, readFcstdLightArchive, readFcstdLightBytes } from "./fcstdBatchFiles.js";
import { CadObjectInfoBudget } from "../features/cad-object-info/budget.js";
import { CadObjectInfoError } from "../features/cad-object-info/error.js";
let root: string, filename: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-light-zip-integrity-")); filename = path.join(root, "Probe.FCStd"); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function central(bytes: Uint8Array) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 22 + 16, true); }
describe("shared extraction light profile strict declaration/actual byte integrity", () => {
  it("rejects a FIFO without waiting for a writer, using an isolated child handshake", async () => {
    execFileSync("mkfifo", [filename]);
    const source = `import {readFcstdLightBytes} from ${JSON.stringify(new URL("./fcstdBatchFiles.ts", import.meta.url).href)};
      process.once('message', () => { let code; try { readFcstdLightBytes(${JSON.stringify(filename)}); }
        catch(error) { code=error.code; } process.send({phase:'result',code},()=>process.exit(0)); });
      process.send({phase:'ready'});`;
    const child = spawn(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), "--input-type=module", "--eval", source], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)), env: process.env, stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = ""; child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        // Watchdog only bounds a broken child; ready/go messages drive the read.
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`FIFO watchdog: ${stderr}`)); }, 5000);
        child.on("message", message => {
          if (!message || typeof message !== "object" || !("phase" in message)) return;
          if (message.phase === "ready") child.send({ phase: "go" });
          if (message.phase === "result") { clearTimeout(timer); resolve(message); }
        });
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error(`FIFO child exited ${code}: ${stderr}`)); });
      });
      expect(result).toEqual({ phase: "result", code: "invalid_arguments" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
      }
    }
  });
  it("retains both a typed read cancellation and an independent close failure", () => {
    fs.writeFileSync(filename, "independent fixture");
    const cancelled = new CadObjectInfoError("cancelled", "读取已取消"), cleanup = new Error("synthetic close failure");
    vi.spyOn(fs, "readSync").mockImplementation(() => { throw cancelled; });
    const close = fs.closeSync.bind(fs);
    vi.spyOn(fs, "closeSync").mockImplementation(fd => { close(fd); throw cleanup; });
    try { readFcstdLightBytes(filename, new CadObjectInfoBudget()); throw new Error("unexpected success"); }
    catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([cancelled, cleanup]); }
  });
  it.each([0, 6] as const)("rejects false XML size declarations before accepting a projection, level %s", level => {
    const bytes = zipSync({ "Document.xml": strToU8("<Document/>") }, { level });
    const view = new DataView(bytes.buffer); view.setUint32(central(bytes) + 24, 1, true); fs.writeFileSync(filename, bytes);
    expect(() => readFcstdLightArchive(filename)).toThrow();
  });
  it("rejects a deflate stream whose real output is larger than its matching fake headers and truncated CRC", () => {
    const prefix = strToU8("<Document/>"), bytes = zipSync({ "Document.xml": strToU8("<Document/>" + " ".repeat(100000)) });
    const prefixZip = zipSync({ "Document.xml": prefix }, { level: 0 });
    const prefixCrc = new DataView(prefixZip.buffer).getUint32(central(prefixZip) + 16, true), view = new DataView(bytes.buffer);
    // Both headers and the prefix CRC are consistent; only actual inflate length
    // exposes the attack. The public sample is metadata and padding only.
    view.setUint32(22, prefix.length, true); view.setUint32(14, prefixCrc, true);
    view.setUint32(central(bytes) + 24, prefix.length, true); view.setUint32(central(bytes) + 16, prefixCrc, true);
    fs.writeFileSync(filename, bytes); expect(() => readFcstdLightArchive(filename)).toThrow();
  });
  it("does not inflate non-XML content but retains the reviewed total declared size ceiling", () => {
    const bytes = zipSync({ "Document.xml": strToU8("<Document/>"), "opaque.bin": new Uint8Array([7]) });
    const start = central(bytes), view = new DataView(bytes.buffer), second = start + 46 + view.getUint16(start + 28, true) + view.getUint16(start + 30, true) + view.getUint16(start + 32, true);
    view.setUint32(second + 24, 256 * 1024 * 1024, true); fs.writeFileSync(filename, bytes);
    expect(() => readFcstdLightArchive(filename)).toThrowError(expect.objectContaining({ code: "resource_limit" }));
  });
  it("rejects CRC mismatch, unsupported compression, false actual stored length and duplicate case aliases", () => {
    const bytes = zipSync({ "Document.xml": strToU8("<Document/>") }, { level: 0 }), start = central(bytes);
    for (const mutate of [
      (data: Uint8Array) => { data[42] ^= 1; },
      (data: Uint8Array) => { const view = new DataView(data.buffer); view.setUint16(8, 99, true); view.setUint16(start + 10, 99, true); },
      (data: Uint8Array) => { const view = new DataView(data.buffer); view.setUint32(22, FCSTD_LIGHT_XML_BYTES, true); view.setUint32(start + 24, FCSTD_LIGHT_XML_BYTES, true); },
    ]) { const changed = bytes.slice(); mutate(changed); fs.writeFileSync(filename, changed); expect(() => readFcstdLightArchive(filename)).toThrow(); }
    fs.writeFileSync(filename, zipSync({ "DOCUMENT.XML": strToU8("<Document/>"), "Document.xml": strToU8("<Document/>") }));
    expect(() => readFcstdLightArchive(filename)).toThrowError(expect.objectContaining({ code: "invalid_fcstd_archive" }));
  });
});
