import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Cloud, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { SERVER_DEFAULTS, resetTo } from "@/lib/factory-defaults";
import { SettingRow } from "@/components/SettingRow";
import { SectionCard } from "@/components/SectionCard";
import { useServerSuggestions } from "@/lib/use-server-suggestions";
import { providerOf } from "@/lib/providers";
import { useModelSuggestions } from "@/lib/use-model-suggestions";
import { normalizeServerUrl, type PairGrant } from "@/lib/server";
import { PairPanel } from "./PairPanel";
import type { ServerStatus } from "./TranscriptionView";

interface ServerTabProps {
  serverUrl: string;
  serverStatus: ServerStatus;
  onServerUrlChange: (url: string) => void;
  checkServerHealth: (silent?: boolean) => void;
  serverToken: string;
  onServerTokenChange: (token: string) => void;
  serverModel: string;
  onServerModelChange: (model: string) => void;
  serverFallback: boolean;
  onServerFallbackChange: (value: boolean) => void;
}

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

/**
 * What a field shows while it is being typed in, which follows the value the backend confirmed
 * as soon as the field is left: a save that is refused rolls the value back, and the field
 * must not keep showing the text that was refused.
 */
function useDraft(value: string): [string, (draft: string) => void, { onFocus: () => void; onBlur: () => void }] {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return [
    draft,
    setDraft,
    {
      onFocus: () => {
        editing.current = true;
      },
      onBlur: () => {
        editing.current = false;
      },
    },
  ];
}

export function ServerTab({
  serverUrl,
  serverStatus,
  onServerUrlChange,
  checkServerHealth,
  serverToken,
  onServerTokenChange,
  serverModel,
  onServerModelChange,
  serverFallback,
  onServerFallbackChange,
}: ServerTabProps) {
  const { t } = useTranslation();
  const [urlInput, setUrlInput, urlField] = useDraft(serverUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [tokenInput, setTokenInput, tokenField] = useDraft(serverToken || "");
  const [modelInput, setModelInput, modelField] = useDraft(serverModel || "");

  const [pairTarget, setPairTarget] = useState<{ url: string; label: string } | null>(null);

  const { groups: urlGroups, discovered } = useServerSuggestions();
  const provider = providerOf(urlInput);

  const model = useModelSuggestions(urlInput, serverUrl, serverToken, modelInput);

  const pairTyped = () => {
    try {
      new URL(urlInput);
      setUrlError(null);
      // A server found on the network is named as it announces itself.
      const found = discovered.find((server) => normalizeServerUrl(server.url) === normalizeServerUrl(urlInput));
      setPairTarget({ url: urlInput, label: found?.name ?? urlInput });
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

  const pickServer = (url: string) => {
    setUrlError(null);
    onServerUrlChange(url);
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
            <Combobox
              value={urlInput}
              onChange={setUrlInput}
              onPick={pickServer}
              groups={urlGroups}
              toggleLabel={t("transcription.server.knownServers")}
              onFocus={urlField.onFocus}
              onBlur={() => {
                urlField.onBlur();
                if (urlInput !== serverUrl) saveServerUrl();
              }}
              onKeyDown={(e) => e.key === "Enter" && saveServerUrl()}
              placeholder="http://localhost:8000"
              className="text-xs tabular-nums"
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
            {/* Pairing is a Talk server's, and means nothing to a provider. */}
            {!provider && (
              <>
                <span aria-hidden="true">·</span>
                <Button variant="link" onClick={pairTyped} className="h-auto p-0 text-xs">
                  {t("transcription.server.pairWith")}
                </Button>
              </>
            )}
          </div>
          <Input
            id="server-token"
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onFocus={tokenField.onFocus}
            onBlur={() => {
              tokenField.onBlur();
              if (tokenInput !== serverToken) onServerTokenChange(tokenInput);
            }}
            placeholder={t("transcription.server.tokenPlaceholder")}
            className="w-full text-xs tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            {provider
              ? t("transcription.server.keyPage", { page: provider.keyPage })
              : t("transcription.server.tokenHint")}
          </p>
        </div>

        {/* Model */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">
            {t("transcription.server.model")} {t("transcription.server.optional")}
          </label>
          <Combobox
            value={modelInput}
            onChange={setModelInput}
            onPick={onServerModelChange}
            groups={model.groups}
            toggleLabel={t("transcription.server.knownModels")}
            onFocus={modelField.onFocus}
            onBlur={() => {
              modelField.onBlur();
              if (modelInput.trim() !== serverModel) onServerModelChange(modelInput.trim());
            }}
            placeholder={model.placeholder}
            aria-invalid={model.unknown}
            className={cn(
              "text-xs tabular-nums",
              model.unknown &&
                "border-[color-mix(in_oklch,var(--color-destructive)_70%,var(--color-input))] focus:border-[var(--color-destructive)] focus:ring-[color-mix(in_oklch,var(--color-destructive)_18%,transparent)]",
            )}
          />
          <p className={cn("text-xs", model.unknown ? "text-[var(--color-destructive)]" : "text-muted-foreground")}>
            {model.hint}
          </p>
        </div>

        {/* Local fallback */}
        <SettingRow
          onReset={resetTo(serverFallback, SERVER_DEFAULTS.server_fallback, onServerFallbackChange)}
          label={t("transcription.server.fallback")}
          hint={t("transcription.server.fallbackHint")}
        >
          <Switch checked={serverFallback} onCheckedChange={onServerFallbackChange} />
        </SettingRow>
      </SectionCard>
    </div>
  );
}
