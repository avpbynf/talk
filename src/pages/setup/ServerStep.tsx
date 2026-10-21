import { useId } from "react";
import { AlertCircle, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { providerOf } from "@/lib/providers";
import { useServerSuggestions } from "@/lib/use-server-suggestions";
import { useModelSuggestions } from "@/lib/use-model-suggestions";
import type { ServerStatus } from "@/lib/server";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { isServerUrl } from "./serverUrl";
import { StepPage } from "./StepPage";
import { StepTitle } from "./StepTitle";
import { Tile } from "./Tile";

interface ServerStepProps {
  url: string;
  token: string;
  model: string;
  /** The URL the settings hold since the last test, which the server's models are asked for. */
  testedUrl: string;
  status: ServerStatus;
  onUrlChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onModelChange: (model: string) => void;
  onTest: () => void;
}

const STATUS_LOOK = {
  unknown: { icon: AlertCircle, tone: "muted" },
  checking: { icon: Loader2, tone: "accent" },
  online: { icon: Wifi, tone: "ok" },
  unauthorized: { icon: AlertCircle, tone: "warn" },
  offline: { icon: WifiOff, tone: "bad" },
} as const;

const FIELD = "h-[42px] w-full px-3.5 text-sm";

export function ServerStep({
  url,
  token,
  model,
  testedUrl,
  status,
  onUrlChange,
  onTokenChange,
  onModelChange,
  onTest,
}: ServerStepProps) {
  const { t } = useTranslation();
  const urlId = useId();
  const tokenId = useId();
  const modelId = useId();
  const look = STATUS_LOOK[status];
  const canRetry = status === "offline" || status === "unauthorized";
  const { groups } = useServerSuggestions();
  const provider = providerOf(url);
  const models = useModelSuggestions(url, testedUrl, status, model);

  return (
    <StepPage>
      <StepTitle title={t("setup.server.title")} subtitle={t("setup.server.subtitle")} />

      <div className="flex flex-col gap-2">
        <label htmlFor={urlId} className="text-[13px] font-medium">
          {t("setup.server.url")}
        </label>
        <Combobox
          id={urlId}
          type="url"
          value={url}
          onChange={onUrlChange}
          onPick={onUrlChange}
          groups={groups}
          toggleLabel={t("transcription.server.knownServers")}
          placeholder={t("setup.server.placeholder")}
          className={cn(
            FIELD,
            status === "offline" && "border-[color-mix(in_oklch,var(--color-destructive)_70%,var(--color-input))]",
            status === "online" && "border-[color-mix(in_oklch,var(--color-success)_60%,var(--color-input))]",
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={tokenId} className="text-[13px] font-medium">
          {t("setup.server.token")}
        </label>
        <Input
          id={tokenId}
          type="password"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder={t("setup.server.tokenPlaceholder")}
          autoComplete="off"
          className={cn(
            FIELD,
            status === "unauthorized" && "border-[color-mix(in_oklch,var(--color-destructive)_70%,var(--color-input))]",
          )}
        />
        {provider && (
          <p className="text-xs text-muted-foreground">
            {t("transcription.server.keyPage", { page: provider.keyPage })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={modelId} className="text-[13px] font-medium">
          {t("transcription.server.model")} {t("transcription.server.optional")}
        </label>
        <Combobox
          id={modelId}
          value={model}
          onChange={onModelChange}
          onPick={onModelChange}
          groups={models.groups}
          toggleLabel={t("transcription.server.knownModels")}
          placeholder={models.placeholder}
          aria-invalid={models.unknown}
          className={cn(
            FIELD,
            models.unknown && "border-[color-mix(in_oklch,var(--color-destructive)_70%,var(--color-input))]",
          )}
        />
        <p className={cn("text-xs", models.unknown ? "text-[var(--color-destructive)]" : "text-muted-foreground")}>
          {models.hint}
        </p>
      </div>

      <Card>
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Tile icon={look.icon} tone={look.tone} size="sm" spin={status === "checking"} />
          <span className="flex-1 text-sm">{t(`setup.server.status.${status}`)}</span>
          <Button variant="outline" size="sm" onClick={onTest} disabled={status === "checking" || !isServerUrl(url)}>
            {canRetry ? (
              <>
                <RefreshCw />
                {t("common.retry")}
              </>
            ) : (
              t("setup.server.test")
            )}
          </Button>
        </div>
      </Card>
    </StepPage>
  );
}
