import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { resolve } from "path";
import { localApiProxy } from "./config/localApiProxy";
import {
  createPhoenixWingSourceAliases,
  LOCAL_WING_PACKAGE_NAMES,
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
const localWingOptimizeExcludes = localWingRoot
  ? ["phoenix-wing", ...LOCAL_WING_PACKAGE_NAMES]
  : [];

console.log(
  localWingRoot
    ? `[Wing][LOCAL][web] ${localWingRoot}`
    : "[Wing][REGISTRY][web] package.json + pnpm-lock.yaml",
);

export default defineConfig({
  // 本地 Wing 源码 alias 不能复用 Registry 预构建物；否则 mode 切换后浏览器会继续
  // 加载 0.5.x 的 phoenix-wing.js，遗漏 0.6 新导出。保留旧缓存但按 mode 隔离。
  cacheDir: localWingRoot ? "node_modules/.vite-local-wing" : "node_modules/.vite",
  optimizeDeps: {
    exclude: localWingOptimizeExcludes,
  },
  plugins: [
    vue(),
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
      "@phoenix-wing/db-node",
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
      "/api/caa/index": localApiProxy(`http://127.0.0.1:${caaPort}`),
      "/api/caa": localApiProxy(`http://127.0.0.1:${caaPort}`),
      "/api/cad": localApiProxy(`http://127.0.0.1:${caaPort}`),
      "/api": localApiProxy(`http://127.0.0.1:${caaPort}`),
    },
  },
});
