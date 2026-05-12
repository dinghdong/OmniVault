import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/contracts/*.test.ts"],
    environment: "node",
    globals: true,
    timeout: 60000,
  },
});
