import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { resolve } from "path";
import { resolvePhoenixWingPath } from "./config/resolvePhoenixWing";

/** 开发：Vite 5173，Node Hono 5180。 */
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
  // Choice-dialog refs are shared between the root barrel and Vue subpath components.
  // Prebundling only the barrel creates a second singleton in development.
  optimizeDeps: {
    exclude: ["phoenix-wing"],
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
