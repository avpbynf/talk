import { useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { motion, useAnimate } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { useTranslation } from "react-i18next";
import { UserRound } from "lucide-react";
import { Blobatar } from "@blobatar/react";
import "blobatar/motion.css";
import { cn } from "@/lib/utils";
import { useGoogleAccount, type GoogleStatus } from "@/lib/use-google-account";
import { WindowDots } from "@/components/WindowDots";

export interface NavItem<Id extends string = string> {
  id: Id;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}

export type StatusTone = "warn" | "bad";

/** Something wrong or under way with the engine; there is no status when all is well. */
export interface EngineStatus {
  label: string;
  tone: StatusTone;
  /** Still in progress, so the dot pulses. */
  busy?: boolean;
}

interface SidebarProps<Id extends string> {
  top: NavItem<Id>[];
  bottom: NavItem<Id>[];
  current: Id;
  /** The page the account entry opens. */
  accountTarget: Id;
  onNavigate: (id: Id) => void;
  status: EngineStatus | null;
  onStatusClick?: () => void;
  /** Where the window buttons are. On the left they sit in the top row of the sidebar. */
  windowButtons?: "left" | "right";
}

const STORAGE_KEY = "talk.sidebar.collapsed";
const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const TONE_PILL: Record<StatusTone, string> = {
  warn: "text-warning border-warning/40 bg-warning/10",
  bad: "text-destructive border-destructive/40 bg-destructive/10",
};

const LABEL =
  "transition-[opacity,transform] duration-300 group-data-[collapsed=true]/side:opacity-0 group-data-[collapsed=true]/side:-translate-x-1.5 group-data-[collapsed=true]/side:pointer-events-none";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function Sidebar<Id extends string>({
  top,
  bottom,
  current,
  accountTarget,
  onNavigate,
  status,
  onStatusClick,
  windowButtons = "right",
}: SidebarProps<Id>) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const { status: account } = useGoogleAccount();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const topIds = top.map((item) => item.id as string);
  const activeKey = current === accountTarget ? "account" : current;
  const groupOf = (key: string) => (topIds.includes(key) ? "top" : "bottom");

  const buttons = useRef(new Map<string, HTMLElement>());
  const [indicator, animateIndicator] = useAnimate<HTMLDivElement>();
  const previous = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = indicator.current;
    const button = buttons.current.get(activeKey);
    if (!el || !button) return;

    const target = { y: button.offsetTop, height: button.offsetHeight, opacity: 1 };
    const before = previous.current;
    previous.current = activeKey;
    let cancelled = false;

    if (before === null || before === activeKey || reduced) {
      animateIndicator(el, target, { duration: 0 });
    } else if (groupOf(before) !== groupOf(activeKey)) {
      // Crossing between the two groups would drag the highlight over the whole
      // sidebar, so it fades out where it is and comes back on the new link.
      (async () => {
        await animateIndicator(el, { opacity: 0 }, { duration: 0.11, ease: "easeIn" });
        if (cancelled) return;
        await animateIndicator(el, { y: target.y, height: target.height }, { duration: 0 });
        await animateIndicator(el, { opacity: 1 }, { duration: 0.3, ease: EASE_OUT });
      })();
    } else {
      animateIndicator(el, target, { type: "spring", stiffness: 420, damping: 30, mass: 0.8 });
    }
    return () => {
      cancelled = true;
    };
    // groupOf only reads the item ids, which do not change between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, reduced]);

  // A resized or maximized window moves the bottom group; the highlight follows
  // without gliding.
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      const el = indicator.current;
      const button = buttons.current.get(activeKeyRef.current);
      if (!el || !button) return;
      animateIndicator(el, { y: button.offsetTop, height: button.offsetHeight }, { duration: 0 });
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [indicator, animateIndicator]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // The choice just does not outlive the session.
    }
  }

  function track(key: string) {
    return (node: HTMLElement | null) => {
      if (node) buttons.current.set(key, node);
      else buttons.current.delete(key);
    };
  }

  function renderItem(item: NavItem<Id>) {
    const active = activeKey === item.id;
    return (
      <button
        key={item.id}
        ref={track(item.id)}
        onClick={() => onNavigate(item.id)}
        aria-current={active ? "page" : undefined}
        title={item.label}
        className={cn(
          "relative z-[1] shrink-0 flex items-center gap-[11px] h-[34px] pl-[14px] pr-[10px] rounded-lg text-sm whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-active)]",
          active ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <item.icon
          strokeWidth={2}
          className={cn("h-[17px] w-[17px] shrink-0 transition-colors", active && "text-[var(--color-active)]")}
        />
        <span className={LABEL}>{item.label}</span>
      </button>
    );
  }

  const email = account?.available ? account.email : null;
  const accountActive = activeKey === "account";

  return (
    <motion.nav
      aria-label={t("sidebar.label")}
      data-collapsed={collapsed}
      initial={false}
      animate={{ width: collapsed ? 66 : 226 }}
      transition={reduced ? { duration: 0 } : { duration: 0.55, ease: [0.34, 1.25, 0.64, 1] }}
      className="group/side relative shrink-0 motion-reduce:**:transition-none flex flex-col overflow-hidden bg-surface-inset border-r border-border-subtle pb-2.5"
    >
      <div
        data-tauri-drag-region
        className={cn(
          "mx-2.5 mt-3 mb-[18px] h-[34px] shrink-0 flex items-center pl-3 select-none",
          windowButtons === "left" &&
            "justify-between group-data-[collapsed=true]/side:h-auto group-data-[collapsed=true]/side:flex-col group-data-[collapsed=true]/side:justify-center group-data-[collapsed=true]/side:pl-0",
        )}
      >
        <span
          data-tauri-drag-region
          className={cn(
            "text-[15px] font-semibold tracking-tight",
            windowButtons === "left" && "group-data-[collapsed=true]/side:absolute",
            LABEL,
          )}
        >
          Talk
        </span>
        {windowButtons === "left" && <WindowDots />}
      </div>

      <div ref={listRef} className="relative flex-1 min-h-0 flex flex-col gap-0.5 px-2.5">
        <div
          ref={indicator}
          aria-hidden="true"
          style={{ opacity: 0 }}
          className="absolute left-2.5 right-2.5 top-0 h-[34px] rounded-lg pointer-events-none z-0 bg-[linear-gradient(90deg,color-mix(in_oklch,var(--s1)_22%,transparent),color-mix(in_oklch,var(--s4)_6%,transparent))] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--s1)_26%,transparent)]"
        />

        {top.map(renderItem)}
        <div className="flex-1" />

        {status && (
          <button
            onClick={onStatusClick}
            title={status.label}
            className={cn(
              "shrink-0 mx-1 mb-2 self-start max-w-[calc(100%-0.5rem)] flex items-center justify-center gap-[7px] h-[26px] pl-[9px] pr-[11px] rounded-full border text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-active)] group-data-[collapsed=true]/side:w-[26px] group-data-[collapsed=true]/side:self-center group-data-[collapsed=true]/side:px-0",
              TONE_PILL[status.tone],
            )}
          >
            <i
              className={cn(
                "h-[7px] w-[7px] shrink-0 rounded-full bg-current",
                status.busy && "animate-pulse motion-reduce:animate-none",
              )}
            />
            <span className="truncate group-data-[collapsed=true]/side:hidden">{status.label}</span>
          </button>
        )}

        {bottom.map(renderItem)}

        <div className="h-px bg-border-subtle mx-1.5 my-2 shrink-0" />

        <button
          ref={track("account")}
          onClick={() => onNavigate(accountTarget)}
          aria-current={accountActive ? "page" : undefined}
          title={email ?? t("sidebar.account.title")}
          className={cn(
            "relative z-[1] shrink-0 flex items-center gap-2.5 h-[46px] pl-[7px] pr-2 rounded-lg whitespace-nowrap text-left transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-active)]",
            !accountActive && "hover:bg-surface-raised",
          )}
        >
          {email ? (
            <Blobatar
              name={email}
              size={32}
              animate="always"
              aria-hidden="true"
              className="shrink-0 rounded-full"
            />
          ) : (
            <span className="h-8 w-8 shrink-0 rounded-full bg-surface-active text-muted-foreground flex items-center justify-center">
              <UserRound className="h-4 w-4" />
            </span>
          )}
          <span className={cn("flex flex-col min-w-0 gap-px", LABEL)}>
            <b className="text-[13px] font-medium truncate max-w-[150px]">
              {email ?? t("sidebar.account.title")}
            </b>
            <small className="inline-flex items-center gap-[5px] text-[11px] text-muted-foreground">
              <i
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-[400ms]",
                  email && account ? SYNC_DOT[syncTone(account)] : SYNC_DOT.off,
                )}
              />
              {email && account ? syncWord(account, t) : t("sidebar.account.signedOut")}
            </small>
          </span>
        </button>
      </div>

      <button
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        className="absolute z-[3] top-1/2 right-[3px] w-1.5 h-11 -translate-y-1/2 rounded-full bg-foreground/20 opacity-0 group-hover/side:opacity-100 focus-visible:opacity-100 hover:h-16 hover:bg-[var(--color-active)] transition-[opacity,height,background-color] duration-300 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-active)]"
      />
    </motion.nav>
  );
}

const SYNC_DOT = {
  ok: "bg-success",
  warn: "bg-warning",
  off: "bg-muted-foreground/60",
} as const;

function syncTone(status: GoogleStatus): keyof typeof SYNC_DOT {
  if (status.lastError) return "warn";
  if (status.syncing || status.lastSyncMs) return "ok";
  return "off";
}

function syncWord(status: GoogleStatus, t: (key: string) => string): string {
  if (status.syncing) return t("sidebar.sync.syncing");
  if (status.lastError) return t("sidebar.sync.error");
  if (status.lastSyncMs) return t("sidebar.sync.synced");
  return t("sidebar.sync.notSynced");
}
