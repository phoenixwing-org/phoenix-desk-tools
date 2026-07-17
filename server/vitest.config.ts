import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: ["default", "html"],
    outputFile: {
      html: "../test-report/index.html",
    },
  },
});
