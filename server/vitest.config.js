import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.js"],
    fileParallelism: false, // integration tests share one database
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
