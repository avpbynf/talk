import { test as base, expect, type Page } from "@playwright/test";
import { defaultState, FIXED_NOW, type NativeState } from "./data";
import { installNativeMock, type MockCall, type MockHandle } from "./native-mock";

export { expect };

/** `nav` is the sidebar link, `shows` something only that page puts on screen: no page has a title. */
export const PAGES = [
  { id: "dashboard", nav: "Dashboard", shows: (page: Page) => page.getByRole("button", { name: "Reset stats" }) },
  {
    id: "history",
    nav: "History",
    shows: (page: Page) => page.getByRole("combobox", { name: "How many transcriptions to keep" }),
  },
  { id: "vocabulary", nav: "Vocabulary", shows: (page: Page) => page.getByText("Add terms", { exact: true }) },
  { id: "engine", nav: "Engine", shows: (page: Page) => page.getByRole("radiogroup", { name: "Engine" }) },
  { id: "dictation", nav: "Dictation", shows: (page: Page) => page.getByText("Shortcuts", { exact: true }) },
  { id: "appearance", nav: "Appearance", shows: (page: Page) => page.getByRole("radiogroup", { name: "Appearance" }) },
  { id: "settings", nav: "Settings", shows: (page: Page) => page.getByText("Audio devices", { exact: true }) },
  {
    id: "account",
    nav: /^(Account|\S+@\S+)/,
    shows: (page: Page) =>
      page.getByText(/^(Optional\. Signing in only syncs|Sign-in is not available|What follows your account)/).first(),
  },
] as const;

export type PageEntry = (typeof PAGES)[number];
export type PageId = PageEntry["id"];

type StatePatch = {
  [K in keyof NativeState]?: NativeState[K] extends unknown[]
    ? NativeState[K]
    : NativeState[K] extends object
      ? Partial<NativeState[K]>
      : NativeState[K];
};

export interface OpenOptions {
  /** Merged over the default machine, one level deep for objects. */
  state?: StatePatch;
  /** Command name to the value it answers instead of the state's. */
  answers?: Record<string, unknown>;
  /** Make a command fail with this message. */
  failing?: Record<string, string>;
  /** Make a command never answer, as a model that takes its time to load. */
  pending?: string[];
  /** Where to land, default the app's own entry. */
  path?: string;
  /** Skip the wait for the shell, for the routes that do not have one. */
  bare?: boolean;
  /** Pin the clock to the day the fixtures are written against. */
  frozen?: boolean;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class App {
  constructor(
    readonly page: Page,
    readonly problems: string[],
  ) {}

  async open(options: OpenOptions = {}): Promise<void> {
    const state = defaultState() as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(options.state ?? {})) {
      const current = state[key];
      state[key] = isPlain(current) && isPlain(value) ? { ...current, ...value } : value;
    }
    const answers: Record<string, unknown> = { ...options.answers };
    for (const [cmd, message] of Object.entries(options.failing ?? {})) answers[cmd] = { __reject: message };
    for (const cmd of options.pending ?? []) answers[cmd] = { __pending: true };

    if (options.frozen) await this.page.clock.setFixedTime(new Date(FIXED_NOW));
    await this.page.addInitScript(installNativeMock, { state: state as unknown as NativeState, answers });
    await this.page.goto(options.path ?? "/");
    if (!options.bare) await this.ready();
  }

  /** The shell is on screen and the first page has finished arriving. */
  async ready(): Promise<void> {
    await expect(this.sidebar).toBeVisible();
    await expect(this.marker(PAGES[0])).toBeVisible();
    await this.settle();
  }

  get sidebar() {
    return this.page.getByRole("navigation", { name: "Main navigation" });
  }

  /** Something only this page puts on screen, so a click is known to have landed. */
  marker(page: PageEntry) {
    return page.shows(this.page);
  }

  link(page: PageEntry) {
    return this.sidebar.getByRole("button", { name: page.nav });
  }

  async go(page: PageEntry): Promise<void> {
    await this.link(page).click();
    await expect(this.link(page)).toHaveAttribute("aria-current", "page");
    await expect(this.marker(page)).toBeVisible();
    await this.settle();
  }

  /**
   * Fonts are in and nothing of the page is still arriving: the page
   * transition leaves inline opacity and transform on a block until it ends,
   * and the sidebar width is a spring.
   */
  async settle(): Promise<void> {
    await this.page.evaluate(() => document.fonts.ready);
    await expect
      .poll(
        () =>
          this.page.evaluate(() => {
            const blocks = Array.from(document.querySelectorAll<HTMLElement>("[data-page-blocks] > *"));
            const nav = document.querySelector("nav");
            const width = nav ? Math.round(nav.getBoundingClientRect().width) : 0;
            return {
              blocks: blocks
                .filter((el) => el.style.opacity || el.style.transform || el.style.filter)
                .map((el) => el.getAttribute("style")),
              nav: width === 66 || width === 226,
            };
          }),
        { message: "the page and the sidebar settle", timeout: 10_000 },
      )
      .toEqual({ blocks: [], nav: true });
  }

  async calls(cmd?: string): Promise<MockCall[]> {
    const all = await this.page.evaluate(
      () => (window as unknown as { __nativeMock: MockHandle }).__nativeMock.calls,
    );
    return cmd ? all.filter((c) => c.cmd === cmd) : all;
  }

  async emit(event: string, payload?: unknown): Promise<void> {
    await this.page.evaluate(
      ([name, data]) => (window as unknown as { __nativeMock: MockHandle }).__nativeMock.emit(name as string, data),
      [event, payload] as const,
    );
  }

  async unmocked(): Promise<string[]> {
    return this.page.evaluate(
      () => (window as unknown as { __nativeMock?: MockHandle }).__nativeMock?.unmocked ?? [],
    );
  }
}

/**
 * Every test gets an App, and ends by failing on anything the page complained
 * about: a console error, an uncaught exception, a request that did not
 * succeed, or a native command nobody answered.
 */
export const test = base.extend<{ app: App }>({
  app: async ({ page }, use, testInfo) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
    page.on("requestfailed", (request) =>
      problems.push(`request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText})`),
    );
    page.on("response", (response) => {
      if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
    });

    const app = new App(page, problems);
    await use(app);

    if (testInfo.status === testInfo.expectedStatus) {
      const missing = await app.unmocked().catch(() => []);
      expect(missing, "native commands the mock does not answer").toEqual([]);
      expect(problems, "console errors, uncaught exceptions and failed requests").toEqual([]);
    }
  },
});
