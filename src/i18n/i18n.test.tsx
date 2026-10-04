import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import i18n, { resolveLanguage, formatNumber } from "@/i18n";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import VocabularyView from "@/views/VocabularyView";
import { PairingBanner } from "@/components/PairingBanner";
import { NoModelBanner } from "@/components/NoModelBanner";

function keysOf(node: unknown, prefix = ""): string[] {
  if (Array.isArray(node)) return node.map((_, i) => `${prefix}.${i}`);
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      keysOf(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

function placeholdersOf(text: string): string[] {
  return (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();
}

function lookup(root: unknown, path: string): string {
  return path.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], root) as string;
}

afterEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});

describe("the translation files", () => {
  it("carry exactly the same keys in English and in French", () => {
    const english = keysOf(en).sort();
    const french = keysOf(fr).sort();

    expect(french.filter((key) => !english.includes(key))).toEqual([]);
    expect(english.filter((key) => !french.includes(key))).toEqual([]);
  });

  it("leave no value empty", () => {
    for (const key of keysOf(fr)) {
      expect(lookup(fr, key), key).not.toBe("");
    }
  });

  it("interpolate the same placeholders in both languages", () => {
    for (const key of keysOf(en)) {
      const english = lookup(en, key);
      if (typeof english !== "string") continue;
      expect(placeholdersOf(lookup(fr, key)), key).toEqual(placeholdersOf(english));
    }
  });
});

describe("resolveLanguage", () => {
  it("takes French from a French locale and English from anything else", () => {
    expect(resolveLanguage("fr")).toBe("fr");
    expect(resolveLanguage("fr-CA")).toBe("fr");
    expect(resolveLanguage("de-DE")).toBe("en");
    expect(resolveLanguage("en-GB")).toBe("en");
  });

  it("follows the webview language when nothing was chosen", () => {
    const spy = vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    expect(resolveLanguage(null)).toBe("fr");
    spy.mockReturnValue("ja-JP");
    expect(resolveLanguage(null)).toBe("en");
    spy.mockRestore();
  });
});

describe("a view in French", () => {
  it("renders its text and its numbers in the chosen language", async () => {
    await act(() => i18n.changeLanguage("fr"));
    render(<VocabularyView vocabulary={["Tauri", "Vulkan"]} onVocabularyChange={() => {}} />);

    expect(screen.getByText("Ajouter des termes")).toBeInTheDocument();
    expect(screen.getByText("Vos termes")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ajouter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirer Tauri" })).toBeInTheDocument();
    expect(screen.queryByText("Add terms")).not.toBeInTheDocument();
  });

  it("groups digits the way the language does", async () => {
    expect(formatNumber(1234.5, 1)).toBe("1,234.5");
    await act(() => i18n.changeLanguage("fr"));
    expect(formatNumber(1234.5, 1).replace(/\s/g, " ")).toBe("1 234,5");
  });
});

describe("the banners in French", () => {
  it("shows a pairing request with its countdown", async () => {
    await act(() => i18n.changeLanguage("fr"));
    render(<PairingBanner pending={[{ requestId: "r1", clientName: "Portable", code: "123456", secondsLeft: 120 }]} />);

    expect(screen.getByText("Portable souhaite utiliser ce PC")).toBeInTheDocument();
    expect(screen.getByLabelText("Code d'appairage")).toHaveTextContent("123456");
    expect(screen.getByText("valable 2:00")).toBeInTheDocument();
  });

  it("says there is no model and offers to choose one", async () => {
    await act(() => i18n.changeLanguage("fr"));
    render(<NoModelBanner onChoose={() => {}} />);

    expect(screen.getByText("Aucun modèle chargé")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choisir un modèle" })).toBeInTheDocument();
  });
});
