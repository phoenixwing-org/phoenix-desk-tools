import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { resolve } from "path";
import { resolvePhoenixWingPath } from "./config/resolvePhoenixWing";

/** 双进程开发：Vite 5173，API 由 ``python -m phoenix.web --dev`` 监听此端口。CAA Node 默认 5180。 */
const apiPort = Number(process.env.PHOENIX_API_PORT || 8765);
const caaPort = Number(process.env.CAA_SERVER_PORT || 5180);

const webRoot = resolve(__dirname);
const localWingSrc = resolvePhoenixWingPath(webRoot);

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: "auto-imports.d.ts",
    }),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: "sass" })],
      dts: "components.d.ts",
    }),
  ],
  resolve: {
    alias: {
      ...(localWingSrc ? { "phoenix-wing": localWingSrc } : {}),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/caa/index": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
      "/api/caa": {
        target: `http://127.0.0.1:${caaPort}`,
        changeOrigin: true,
      },
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
