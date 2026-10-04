import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Clock, Cloud, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingRow } from "@/components/SettingRow";
import { SectionCard } from "@/components/SectionCard";
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
  { value: 10000, label: "10 s" },
  { value: 30000, label: "30 s" },
  { value: 60000, label: "1 min" },
  { value: 120000, label: "2 min" },
];

const STATUS_TONE: Record<ServerStatus, string> = {
  checking: "text-server",
  online: "text-[var(--color-success)]",
  unauthorized: "text-[var(--color-destructive)]",
  offline: "text-[var(--color-destructive)]",
  unknown: "text-muted-foreground",
};

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
    <div className="flex flex-col gap-4">
      {/* Servers on this network */}
      <SectionCard
        icon={Cloud}
        title={t("transcription.server.network")}
        description={t("transcription.server.networkHint")}
      >
        {discovered.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("transcription.server.noneFound")}</p>
        ) : (
          discovered.map((server) => (
            <div key={server.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
                <b className="truncate text-[13px] font-medium">{server.name}</b>
                <small className="truncate text-xs tabular-nums text-muted-foreground">
                  {server.model ? `${server.model}, ` : ""}
                  {server.url}
                </small>
              </div>
              <div className="ml-auto flex shrink-0 gap-2">
                {server.pairing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPairTarget({ url: server.url, label: server.name })}
                  >
                    {t("transcription.server.pair")}
                  </Button>
                )}
                <Button
                  variant={server.url === serverUrl ? "outline" : "default"}
                  size="sm"
                  onClick={() => pickServer(server)}
                  disabled={server.url === serverUrl}
                >
                  {server.url === serverUrl ? t("transcription.server.inUse") : t("transcription.server.use")}
                </Button>
              </div>
            </div>
          ))
        )}
      </SectionCard>

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
      <SectionCard
        icon={Cloud}
        title={t("transcription.server.connection")}
        description={t("transcription.server.endpoint")}
      >
        {/* URL + Test */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">{t("transcription.server.url")}</label>
          <div className="flex gap-2">
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={() => urlInput !== serverUrl && saveServerUrl()}
              onKeyDown={(e) => e.key === "Enter" && saveServerUrl()}
              placeholder="http://localhost:8000"
              className="flex-1 text-xs tabular-nums"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => checkServerHealth(false)}
              disabled={serverStatus === "checking"}
              aria-label={t("transcription.server.recheck")}
              title={t("transcription.server.recheck")}
              className="h-9 w-9 shrink-0"
            >
              <RefreshCw className={serverStatus === "checking" ? "animate-spin" : undefined} />
            </Button>
          </div>
          {urlError && <p className="text-xs text-[var(--color-destructive)]">{urlError}</p>}
          <span role="status" className={cn("inline-flex items-center gap-[7px] text-[13px]", STATUS_TONE[serverStatus])}>
            <i
              aria-hidden="true"
              className={cn(
                "h-[7px] w-[7px] rounded-full bg-current shadow-[0_0_0_3px_color-mix(in_oklch,currentColor_25%,transparent)]",
                serverStatus === "checking" && "animate-pulse motion-reduce:animate-none",
              )}
            />
            {statusText(serverStatus, t)}
          </span>
        </div>

        {/* API token */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
            <label htmlFor="server-token">
              {t("transcription.server.token")} {t("transcription.server.optional")}
            </label>
            <span aria-hidden="true">·</span>
            <Button variant="link" onClick={pairTyped} className="h-auto p-0 text-xs">
              {t("transcription.server.pairWith")}
            </Button>
          </div>
          <Input
            id="server-token"
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onBlur={() => { if (tokenInput !== serverToken) onServerTokenChange(tokenInput); }}
            placeholder={t("transcription.server.tokenPlaceholder")}
            className="w-full text-xs tabular-nums"
          />
          <p className="text-xs text-muted-foreground">{t("transcription.server.tokenHint")}</p>
        </div>

        {/* Model */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">
            {t("transcription.server.model")} {t("transcription.server.optional")}
          </label>
          <Input
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onBlur={() => { if (modelInput.trim() !== serverModel) onServerModelChange(modelInput.trim()); }}
            placeholder="whisper-1, gpt-4o-transcribe..."
            className="w-full text-xs tabular-nums"
          />
          <p className="text-xs text-muted-foreground">{t("transcription.server.modelHint")}</p>
        </div>
      </SectionCard>

      {/* Timeout */}
      <SectionCard
        icon={Clock}
        title={t("transcription.server.timeout")}
        description={t("transcription.server.timeoutHint")}
      >
        <Segmented
          wide
          label={t("transcription.server.timeout")}
          value={String(serverTimeout)}
          onChange={(value) => onServerTimeoutChange(Number(value))}
          options={TIMEOUT_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
        />

        {/* Local fallback */}
        <SettingRow
          label={t("transcription.server.fallback")}
          hint={t("transcription.server.fallbackHint")}
        >
          <Switch checked={serverFallback} onCheckedChange={onServerFallbackChange} />
        </SettingRow>
      </SectionCard>
    </div>
  );
}
