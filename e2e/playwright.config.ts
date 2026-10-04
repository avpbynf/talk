import { defineConfig, devices } from "@playwright/test";

// Its own port, so a `tauri dev` running on 1421 is never the server under test. E2E_PORT moves
// it for a second checkout: two suites on one port are served whichever tree started first.
const PORT = Number(process.env.E2E_PORT) || 1431;

// The suite runs against one bundle served by `vite preview` on CI, instead of the hundred modules a
// development server hands every fresh context. The bundle is built in development mode, with
// React's development build and no minifying: the console errors the harness fails on (a missing
// key, an invalid nesting, a controlled input turned uncontrolled) are written by that build alone.
// Locally the dev server is kept, whose start is instant; E2E_BUILD=1 asks for the bundle there too.
// The build has a folder of its own per port, so two suites never write over each other.
const BUILT = !!process.env.CI || !!process.env.E2E_BUILD;
const OUT = `dist-e2e-${PORT}`;

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
    command: BUILT
      ? `bunx vite build --mode development --minify false --outDir ${OUT} --emptyOutDir && bunx vite preview --mode development --outDir ${OUT} --port ${PORT} --strictPort`
      : `bunx vite --port ${PORT} --strictPort`,
    cwd: "..",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !BUILT,
    env: { NODE_ENV: "development" },
    timeout: 120_000,
  },
});
