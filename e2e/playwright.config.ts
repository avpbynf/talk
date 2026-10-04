import { defineConfig, devices } from "@playwright/test";

// Its own port, so a `tauri dev` running on 1421 is never the server under test. E2E_PORT moves
// it for a second checkout: two suites on one port are served whichever tree started first.
const PORT = Number(process.env.E2E_PORT) || 1431;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
    : [["list"]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    locale: "en-US",
    timezoneId: "UTC",
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    // The runner has no graphics card and draws in software. E2E_SOFTWARE=1 does the same here.
    launchOptions: process.env.E2E_SOFTWARE ? { args: ["--disable-gpu", "--disable-gpu-compositing"] } : {},
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort`,
    cwd: "..",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
