import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { LOCAL_WING_PACKAGE_NAMES, resolveLocalWingExport, resolvePhoenixWingContext } from "../../scripts/phoenix-wing-mode.mjs";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = resolvePhoenixWingContext(path.dirname(serverRoot));
const config = ts.readConfigFile(path.join(serverRoot, "tsconfig.json"), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, serverRoot);
const options = { ...parsed.options };
if (context.mode === "local") {
  options.baseUrl = serverRoot;
  options.paths = Object.fromEntries(LOCAL_WING_PACKAGE_NAMES.map(name => {
    const declaration = resolveLocalWingExport(context.root, name)?.replace(/\.js$/, ".d.ts");
    if (!declaration || !fs.existsSync(declaration)) throw new Error(`本地 Wing 公开类型缺失：${name}`);
    return [name, [declaration]];
  }));
}
const program = ts.createProgram(parsed.fileNames, options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => serverRoot, getNewLine: () => "\n",
  }));
  process.exitCode = 1;
} else console.log(`[Wing][${context.mode.toUpperCase()}][server-types] passed`);
