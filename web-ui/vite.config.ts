import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { resolve } from "path";
import { resolvePhoenixWingPath } from "./config/resolvePhoenixWing";

/** 开发：Vite 5173，Node Hono 5180。 */
const caaPort = Number(process.env.CAA_SERVER_PORT || 5180);
const elementPlusImportStyle = process.env.VITEST ? false : "sass";

const webRoot = resolve(__dirname);
const localWingSrc = resolvePhoenixWingPath(webRoot);

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
    alias: {
      ...(localWingSrc ? { "phoenix-wing": localWingSrc } : {}),
    },
    dedupe: ["vue", "pinia", "phoenix-wing"],
  },
  test: {
    server: {
      deps: {
        inline: ["phoenix-wing"],
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
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
