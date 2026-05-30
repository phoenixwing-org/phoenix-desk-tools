import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
    server: {
    port: 5173,
    // 遗留：双进程开发时 proxy 到 API；推荐 python -m fcdesk.web --build（单端口）
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5173",
        changeOrigin: true,
      },
    },
  },
});
