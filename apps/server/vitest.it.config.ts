import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/seed.integration.test.ts"],
    env: { SEED_IT: "1" },
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
