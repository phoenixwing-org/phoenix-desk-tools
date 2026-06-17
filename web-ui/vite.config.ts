import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/** 双进程开发：Vite 5173，API 由 ``python -m phoenix.web --dev`` 监听此端口。 */
const apiPort = Number(process.env.PHOENIX_API_PORT || process.env.FCDESK_API_PORT || 8765);

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
