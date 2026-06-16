// Playwright E2E for the hivemux web GUI. Uses the system Google Chrome (channel
// 'chrome') so no browser download is needed. The server + a couple of throwaway
// shell agents are booted in global-setup against a temp $HOME, torn down after.
//   bun run build && bun run test:e2e
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
});
