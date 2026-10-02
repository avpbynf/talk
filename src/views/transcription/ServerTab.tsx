import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertCircle, Check, Clock, KeyRound, Loader2, Radar, RefreshCw, Server, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { useDiscoveredServers } from "@/lib/use-discovered-servers";
import type { DiscoveredServer, PairGrant } from "@/lib/server";
import { PairPanel } from "./PairPanel";
import type { ServerStatus } from "./TranscriptionView";

interface ServerTabProps {
  serverUrl: string;
  serverTimeout: number;
  serverStatus: ServerStatus;
  onServerUrlChange: (url: string) => void;
  onServerTimeoutChange: (timeout: number) => void;
  checkServerHealth: (silent?: boolean) => void;
  serverToken: string;
  onServerTokenChange: (token: string) => void;
  serverModel: string;
  onServerModelChange: (model: string) => void;
  serverFallback: boolean;
  onServerFallbackChange: (value: boolean) => void;
}

const TIMEOUT_OPTIONS = [
  { value: 10000, label: "10s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "1min" },
  { value: 120000, label: "2min" },
];

function statusIcon(serverStatus: ServerStatus, size: "sm" | "md" = "md") {
  const sizeClass = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  switch (serverStatus) {
    case "checking":
      return <Loader2 className={cn(sizeClass, "text-server animate-spin")} />;
    case "online":
      return <Check className={cn(sizeClass, "text-[var(--color-success)]")} />;
    case "unauthorized":
      return <KeyRound className={cn(sizeClass, "text-[var(--color-destructive)]")} />;
    case "offline":
      return <WifiOff className={cn(sizeClass, "text-[var(--color-destructive)]")} />;
    default:
      return <AlertCircle className={cn(sizeClass, "text-muted-foreground")} />;
  }
}

function statusText(serverStatus: ServerStatus, t: TFunction) {
  switch (serverStatus) {
    case "checking": return t("transcription.server.status.checking");
    case "online": return t("transcription.server.status.connected");
    case "unauthorized": return t("transcription.server.status.unauthorized");
    case "offline": return t("transcription.server.status.unavailable");
    default: return t("transcription.server.status.notTested");
  }
}

export function ServerTab({
  serverUrl,
  serverTimeout,
  serverStatus,
  onServerUrlChange,
  onServerTimeoutChange,
  checkServerHealth,
  serverToken,
  onServerTokenChange,
  serverModel,
  onServerModelChange,
  serverFallback,
  onServerFallbackChange,
}: ServerTabProps) {
  const { t } = useTranslation();
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState(serverToken || "");
  const [modelInput, setModelInput] = useState(serverModel || "");

  const [pairTarget, setPairTarget] = useState<{ url: string; label: string } | null>(null);

  const discovered = useDiscoveredServers();

  const pairTyped = () => {
    try {
      new URL(urlInput);
      setUrlError(null);
      setPairTarget({ url: urlInput, label: urlInput });
    } catch {
      setUrlError(t("transcription.server.invalidUrl"));
    }
  };

  const paired = (grant: PairGrant, url: string) => {
    setPairTarget(null);
    setUrlInput(url);
    setUrlError(null);
    setTokenInput(grant.token);
    onServerUrlChange(url);
    onServerTokenChange(grant.token);
    checkServerHealth(false);
  };

  const pickServer = (server: DiscoveredServer) => {
    setUrlInput(server.url);
    setUrlError(null);
    onServerUrlChange(server.url);
  };

  const saveServerUrl = () => {
    try {
      new URL(urlInput);
      setUrlError(null);
      onServerUrlChange(urlInput);
    } catch {
      setUrlError(t("transcription.server.invalidUrl"));
    }
  };

  return (
    <div className="space-y-5">
      {/* Servers on this network */}
      <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-8 w-8 rounded-lg bg-[var(--color-server)]/15 flex items-center justify-center">
            <Radar className="h-4 w-4 text-server" />
          </div>
          <div>
            <h3 className="font-medium text-sm">{t("transcription.server.network")}</h3>
            <p className="text-xs text-muted-foreground">{t("transcription.server.networkHint")}</p>
          </div>
        </div>

        {discovered.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("transcription.server.noneFound")}</p>
        ) : (
          <ul className="space-y-2">
            {discovered.map((server) => (
              <li
                key={server.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border-card bg-surface-inset"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{server.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {server.model ? `${server.model}, ` : ""}
                    <span className="font-mono">{server.url}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {server.pairing && (
                    <button
                      onClick={() => setPairTarget({ url: server.url, label: server.name })}
                      className="cursor-pointer px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-surface-active"
                    >
                      {t("transcription.server.pair")}
                    </button>
                  )}
                  <button
                    onClick={() => pickServer(server)}
                    disabled={server.url === serverUrl}
                    className="cursor-pointer px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-surface-active disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    {server.url === serverUrl ? t("transcription.server.inUse") : t("transcription.server.use")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pairTarget && (
        <PairPanel
          key={pairTarget.url}
          url={pairTarget.url}
          label={pairTarget.label}
          onPaired={paired}
          onClose={() => setPairTarget(null)}
        />
      )}

      {/* Server Connection */}
      <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-8 w-8 rounded-lg bg-[var(--color-server)]/15 flex items-center justify-center">
            <Server className="h-4 w-4 text-server" />
          </div>
          <div>
            <h3 className="font-medium text-sm">{t("transcription.server.connection")}</h3>
            <p className="text-xs text-muted-foreground">{t("transcription.server.endpoint")}</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* URL + Test */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">{t("transcription.server.url")}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={() => urlInput !== serverUrl && saveServerUrl()}
                onKeyDown={(e) => e.key === "Enter" && saveServerUrl()}
                placeholder="http://localhost:8000"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-border-card bg-surface-inset focus:outline-none focus:ring-2 focus:ring-[var(--color-server)]/30 focus:border-[var(--color-server)] font-mono"
              />
              <button
                onClick={() => checkServerHealth(false)}
                disabled={serverStatus === "checking"}
                className={cn(
                  "cursor-pointer px-3 py-2 rounded-lg border transition-all duration-200 disabled:cursor-not-allowed",
                  serverStatus === "online"
                    ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                    : serverStatus === "offline" || serverStatus === "unauthorized"
                    ? "border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]"
                    : "border-border hover:bg-surface-active"
                )}
              >
                <RefreshCw className={cn("h-4 w-4 transition-transform", serverStatus === "checking" && "animate-spin")} />
              </button>
            </div>
            {urlError && <p className="text-xs text-[var(--color-destructive)]">{urlError}</p>}
          </div>

          {/* Status */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg",
            serverStatus === "online"
              ? "bg-[var(--color-success)]/10 border border-[var(--color-success)]/20"
              : serverStatus === "offline" || serverStatus === "unauthorized"
              ? "bg-[var(--color-destructive)]/10 border border-[var(--color-destructive)]/20"
              : "bg-surface-inset border border-border-subtle"
          )}>
            {statusIcon(serverStatus)}
            <span className="text-sm">{statusText(serverStatus, t)}</span>
          </div>

          {/* API token */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                {t("transcription.server.token")} <span className="text-xs font-normal">{t("transcription.server.optional")}</span>
              </label>
              <button
                onClick={pairTyped}
                className="cursor-pointer text-xs font-medium text-server hover:underline"
              >
                {t("transcription.server.pairWith")}
              </button>
            </div>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onBlur={() => { if (tokenInput !== serverToken) onServerTokenChange(tokenInput); }}
              placeholder={t("transcription.server.tokenPlaceholder")}
              className="w-full px-3 py-2 rounded-lg bg-surface-inset border border-border-card text-sm font-mono input-glow placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              {t("transcription.server.tokenHint")}
            </p>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("transcription.server.model")} <span className="text-xs font-normal">{t("transcription.server.optional")}</span>
            </label>
            <input
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              onBlur={() => { if (modelInput.trim() !== serverModel) onServerModelChange(modelInput.trim()); }}
              placeholder="whisper-1, gpt-4o-transcribe..."
              className="w-full px-3 py-2 rounded-lg bg-surface-inset border border-border-card text-sm font-mono input-glow placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              {t("transcription.server.modelHint")}
            </p>
          </div>
        </div>
      </div>

      {/* Timeout */}
      <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-8 w-8 rounded-lg bg-[var(--color-server)]/15 flex items-center justify-center">
            <Clock className="h-4 w-4 text-server" />
          </div>
          <div>
            <h3 className="font-medium text-sm">{t("transcription.server.timeout")}</h3>
            <p className="text-xs text-muted-foreground">{t("transcription.server.timeoutHint")}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {TIMEOUT_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => onServerTimeoutChange(option.value)}
              className={cn(
                "px-3 py-2 text-sm font-medium rounded-lg border transition-all duration-200",
                serverTimeout === option.value
                  ? "border-[var(--color-server)] bg-[var(--color-server)]/15 text-server"
                  : "border-border-card bg-surface-inset hover:bg-surface-elevated text-muted-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Local fallback */}
        <div className="flex items-center justify-between gap-4 pt-4 border-t border-border-subtle">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">{t("transcription.server.fallback")}</p>
            <p className="text-xs text-muted-foreground">{t("transcription.server.fallbackHint")}</p>
          </div>
          <Switch checked={serverFallback} onCheckedChange={onServerFallbackChange} />
        </div>
      </div>
    </div>
  );
}
