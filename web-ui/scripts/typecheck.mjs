import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPhoenixWingTypePaths, resolvePhoenixWingContext } from "../../scripts/phoenix-wing-mode.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = resolvePhoenixWingContext(path.dirname(webRoot));
const require = createRequire(import.meta.url);
let temporary;
try {
  let project = path.join(webRoot, "tsconfig.json");
  if (context.mode === "local") {
    const paths = createPhoenixWingTypePaths(context.root);
    // Match Vite's Vue singleton; the sibling checkout may have another Vue version.
    const vueManifest = require.resolve("vue/package.json");
    paths.vue = [path.resolve(path.dirname(vueManifest), JSON.parse(fs.readFileSync(vueManifest, "utf8")).types)];
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "desk-web-types-"));
    const inherited = project;
    project = path.join(temporary, "tsconfig.json");
    fs.writeFileSync(project, JSON.stringify({ extends: inherited, compilerOptions: { baseUrl: webRoot, paths, typeRoots: [path.join(webRoot, "node_modules/@types")] } }));
  }
  console.log(`[Wing][${context.mode.toUpperCase()}][web-types]`);
  const result = spawnSync(process.execPath, [require.resolve("vue-tsc/bin/vue-tsc.js"), "--project", project, "--noEmit", "--pretty", "false"], { cwd: webRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
}
