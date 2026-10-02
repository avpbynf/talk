import { useTranslation } from "react-i18next";
import type { TranscriptionMode } from "@/App";
import type { ServerStatus } from "@/views/transcription/TranscriptionView";
import { cn } from "@/lib/utils";

interface ReadyBandProps {
  transcriptionMode: TranscriptionMode;
  serverStatus: ServerStatus;
  serverUrl: string;
  serverFallback: boolean;
  currentModel: string | null;
  shortcut: string;
}

/** `label` is a translation key. */
type Readiness = { tone: "success" | "warning" | "destructive"; label: string };

/**
 * Whether the shortcut will produce text right now, and what would answer it.
 *
 * Server mode with the fallback on is the one case that is neither ready nor
 * broken: the server is unreachable but a local model can still take it, so it
 * reads as a warning rather than a failure.
 */
function readiness(
  mode: TranscriptionMode,
  serverStatus: ServerStatus,
  serverFallback: boolean,
  currentModel: string | null
): Readiness {
  if (mode === "local") {
    return currentModel
      ? { tone: "success", label: "dashboard.ready.ready" }
      : { tone: "destructive", label: "dashboard.ready.noModelLoaded" };
  }
  if (serverStatus === "online") return { tone: "success", label: "dashboard.ready.ready" };
  if (serverStatus === "checking") return { tone: "warning", label: "dashboard.ready.checkingServer" };
  const refused = serverStatus === "unauthorized";
  if (serverFallback && currentModel) {
    return {
      tone: "warning",
      label: refused ? "dashboard.ready.refusedLocal" : "dashboard.ready.unreachableLocal",
    };
  }
  return {
    tone: "destructive",
    label: refused ? "dashboard.ready.refused" : "dashboard.ready.unreachable",
  };
}

const DOT_CLASS: Record<Readiness["tone"], string> = {
  success:
    "bg-success shadow-[0_0_8px_oklch(from_var(--color-success)_l_c_h/0.6)]",
  warning:
    "bg-warning shadow-[0_0_8px_oklch(from_var(--color-warning)_l_c_h/0.5)]",
  destructive:
    "bg-destructive shadow-[0_0_8px_oklch(from_var(--color-destructive)_l_c_h/0.5)]",
};

const TEXT_CLASS: Record<Readiness["tone"], string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-active border border-border-hover border-b-2 text-xs font-semibold">
      {children}
    </span>
  );
}

/** Strip the host from a URL for display, falling back to the raw string. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

export function ReadyBand({
  transcriptionMode,
  serverStatus,
  serverUrl,
  serverFallback,
  currentModel,
  shortcut,
}: ReadyBandProps) {
  const { t } = useTranslation();
  const state = readiness(transcriptionMode, serverStatus, serverFallback, currentModel);
  const keys = shortcut.split("+");

  return (
    <div className="flex items-center gap-4 px-[18px] py-3 rounded-xl border border-border-card bg-surface-raised">
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("h-[7px] w-[7px] rounded-full", DOT_CLASS[state.tone])} />
          <span className={cn("text-[13px] font-semibold", TEXT_CLASS[state.tone])}>
            {t(state.label)}
          </span>
        </div>

        <div className="w-px h-5 bg-border-subtle shrink-0" />

        <div className="flex items-center gap-1.5 shrink-0">
          {keys.map((key, i) => (
            <span key={key} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-xs text-muted-foreground">+</span>}
              <Key>{key}</Key>
            </span>
          ))}
          <span className="text-[13px] text-muted-foreground ml-1">{t("dashboard.ready.toTalk")}</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2.5 shrink-0">
          {transcriptionMode === "server" ? (
            <>
              <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-[var(--color-server)]/15 text-[var(--color-server)]">
                {t("dashboard.ready.server")}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {shortUrl(serverUrl)}
              </span>
              {serverFallback && (
                <span className="text-xs text-muted-foreground">
                  {currentModel ? t("dashboard.ready.fallbackReady") : t("dashboard.ready.noFallback")}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-[var(--color-active)]/15 text-[var(--color-active)]">
                {t("dashboard.ready.local")}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {currentModel ?? t("dashboard.ready.noModel")}
              </span>
            </>
          )}
      </div>
    </div>
  );
}
