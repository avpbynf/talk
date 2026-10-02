import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Kept apart from vite.config.ts on purpose. That one exports an async factory
// reading TAURI_DEV_HOST and pinning the dev server to port 1421, none of which
// a test run should touch.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // The theme test reads the stylesheets as text, and vitest empties CSS
    // imports unless told otherwise.
    css: { include: [/\.css\?raw$/] },
    setupFiles: ["./src/test/setup.ts"],
    // Anchored at src so a git worktree under .claude/worktrees, which carries
    // its own copy of the tree, does not get its tests collected a second time.
    include: ["src/**/*.test.{ts,tsx}"],
    // src-tauri holds the Rust suite, which cargo test runs.
    exclude: ["node_modules/**", "src-tauri/**", "dist/**", ".claude/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/components/ui/**",
      ],
    },
  },
});
