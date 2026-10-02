import { describe, expect, it } from "vitest";
import indexCss from "../index.css?raw";
import themesCss from "../styles/themes.css?raw";
import { APP_THEME_IDS } from "./app-themes";

const tokens = (block: string) =>
  new Set(block.match(/--color-[a-z-]+(?=\s*:)/g) ?? []);

const defaultTokens = tokens(
  indexCss.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? "",
);

describe("app themes", () => {
  it("reads the default tokens", () => {
    expect(defaultTokens.size).toBeGreaterThan(30);
  });

  it.each(APP_THEME_IDS.filter((id) => id !== "talk-dark"))(
    "%s defines every token of the default theme",
    (id) => {
      const block = themesCss.match(
        new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`),
      )?.[1];
      expect(block, `no block for ${id}`).toBeDefined();
      const defined = tokens(block ?? "");
      const missing = [...defaultTokens].filter((t) => !defined.has(t));
      expect(missing).toEqual([]);
    },
  );
});
