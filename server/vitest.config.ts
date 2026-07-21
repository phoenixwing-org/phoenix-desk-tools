import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCAL_WING_PACKAGE_NAMES,
  resolveLocalWingExport,
  resolvePhoenixWingContext,
} from "../scripts/phoenix-wing-mode.mjs";

const serverRoot = path.dirname(fileURLToPath(import.meta.url));
const deskRoot = path.resolve(serverRoot, "..");
const wingContext = resolvePhoenixWingContext(deskRoot);

const localWingPlugin = wingContext.mode === "local" && wingContext.root
  ? {
      name: "desk-local-phoenix-wing",
      resolveId(source: string) {
        return resolveLocalWingExport(wingContext.root!, source);
      },
    }
  : null;
const localWingAliases = wingContext.mode === "local" && wingContext.root
  ? LOCAL_WING_PACKAGE_NAMES.map((packageName) => ({
      find: new RegExp(`^${packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"),
      replacement: resolveLocalWingExport(wingContext.root!, packageName)!,
    }))
  : [];

console.log(
  wingContext.mode === "local"
    ? `[Wing][LOCAL][server-test] ${wingContext.root}`
    : "[Wing][REGISTRY][server-test] package.json + pnpm-lock.yaml",
);

export default defineConfig({
  plugins: localWingPlugin ? [localWingPlugin] : [],
  resolve: {
    alias: localWingAliases,
  },
  test: {
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    server: {
      deps: {
        inline: [...LOCAL_WING_PACKAGE_NAMES],
      },
    },
    reporters: ["default", "html"],
    outputFile: {
      html: "../test-report/index.html",
    },
  },
});
