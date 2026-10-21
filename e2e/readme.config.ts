import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// The README pictures, taken on demand by `bun run docs:screenshots` and kept out of the suite:
// its own match, so `test:ui` never picks the file up, and one worker, so the pages are drawn
// one after the other on a machine doing nothing else.
export default defineConfig({
  ...base,
  testMatch: "readme-screenshots.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
