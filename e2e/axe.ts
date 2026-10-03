import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export interface Violation {
  rule: string;
  impact: string | null | undefined;
  nodes: string[];
}

/** Contrast is checked on its own, so a page can be held to it without taking any other rule along. */
export const CONTRAST = "color-contrast";

export async function serious(page: Page, rules: { only?: string[]; without?: string[] }): Promise<Violation[]> {
  let axe = new AxeBuilder({ page });
  if (rules.only) axe = axe.withRules(rules.only);
  if (rules.without) axe = axe.disableRules(rules.without);
  const { violations } = await axe.analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 6),
    }));
}
