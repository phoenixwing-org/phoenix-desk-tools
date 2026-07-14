import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(serverRoot, "..");
const outputDir = path.join(serverRoot, "dist-sidecar");
const outputFile = path.join(outputDir, "server.mjs");
const phoenixWingDbAdapter = path.join(
  serverRoot,
  "node_modules",
  "phoenix-wing",
  "src",
  "db",
  "pnwDbAdapter.ts",
);

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    const fallback = path.join(
      repoRoot,
      "node_modules",
      ".pnpm",
      "esbuild@0.25.12",
      "node_modules",
      "esbuild",
      "lib",
      "main.js",
    );
    if (!fs.existsSync(fallback)) {
      throw new Error("esbuild 0.25.12 is not installed; run pnpm install before building the sidecar");
    }
    return import(pathToFileURL(fallback).href);
  }
}

fs.mkdirSync(outputDir, { recursive: true });
const esbuild = await loadEsbuild();
await esbuild.build({
  entryPoints: [path.join(serverRoot, "src", "server.ts")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: 'import { createRequire as __phoenixCreateRequire } from "node:module"; const require = __phoenixCreateRequire(import.meta.url);',
  },
  external: ["node-sqlite3-wasm"],
  plugins: [{
    name: "phoenix-wing-typescript-export",
    setup(build) {
      build.onResolve({ filter: /^phoenix-wing\/db\/pnwDbAdapter$/ }, () => ({
        path: phoenixWingDbAdapter,
      }));
    },
  }],
  logLevel: "info",
});

process.stdout.write(`[sidecar] server bundle -> ${outputFile}\n`);
