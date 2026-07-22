import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { resolve } from "path";
import {
  createPhoenixWingSourceAliases,
  resolvePhoenixWingContext,
} from "./config/resolvePhoenixWing";

/** 开发：Vite 首选 49373，Node Hono 首选 48375。 */
const webPort = Number(process.env.WEB_UI_PORT || 49373);
const caaPort = Number(process.env.CAA_SERVER_PORT || 48375);
const elementPlusImportStyle = process.env.VITEST ? false : "sass";

const webRoot = resolve(__dirname);
const deskRoot = resolve(webRoot, "..");
const wingContext = resolvePhoenixWingContext(deskRoot);
const localWingRoot = wingContext.mode === "local" ? wingContext.root : null;
const localWingAliases = localWingRoot ? createPhoenixWingSourceAliases(localWingRoot) : [];

console.log(
  localWingRoot
    ? `[Wing][LOCAL][web] ${localWingRoot}`
    : "[Wing][REGISTRY][web] package.json + pnpm-lock.yaml",
);

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith("kt-codegen-"),
        },
      },
    }),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: "auto-imports.d.ts",
    }),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: elementPlusImportStyle })],
      dts: "components.d.ts",
    }),
  ],
  resolve: {
    alias: localWingAliases,
    dedupe: [
      "vue",
      "pinia",
      "element-plus",
      "phoenix-wing",
      "@phoenix-wing/code-core",
      "@phoenix-wing/db-node",
      "@phoenix-wing/kt-codegen",
    ],
  },
  test: {
    server: {
      deps: {
        inline: ["phoenix-wing"],
      },
    },
  },
  server: {
    port: webPort,
    strictPort: true,
    ...(localWingRoot ? { fs: { allow: [deskRoot, localWingRoot] } } : {}),
    proxy: {
      "/api/caa/index": {
        target: `http://127.0.0.1:${caaPort}`,
        changeOrigin: true,
      },
      "/api/caa": {
        target: `http://127.0.0.1:${caaPort}`,
        changeOrigin: true,
      },
      "/api/cad": {
        target: `http://127.0.0.1:${caaPort}`,
        changeOrigin: true,
      },
      "/api": {
        target: `http://127.0.0.1:${caaPort}`,
        changeOrigin: true,
      },
    },
  },
});
