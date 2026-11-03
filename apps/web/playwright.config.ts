import { defineConfig } from "@playwright/test";

const port = 8091;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "node --disable-warning=ExperimentalWarning ../server/src/main.ts",
    url: `http://localhost:${port}/health`,
    reuseExistingServer: false,
    env: { PORT: String(port), DATA_DIR: "./.e2e-data", WEB_DIR: "./dist" },
  },
});
