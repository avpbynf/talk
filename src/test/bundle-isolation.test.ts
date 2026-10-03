import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The browser suite fakes the native side with a module of its own. If anything
// under src/ reached for it, it would ride along in the production bundle.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("the browser suite's native mock", () => {
  it("is not imported or named by the application", () => {
    const offenders = sources("src").filter((file) => {
      const text = readFileSync(file, "utf8");
      return /e2e\/|native-mock|installNativeMock|__nativeMock/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
