import { useId } from "react";
import { AlertCircle, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  status: ServerStatus;
  onUrlChange: (url: string) => void;
  onTokenChange: (token: string) => void;
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

export function ServerStep({ url, token, status, onUrlChange, onTokenChange, onTest }: ServerStepProps) {
  const { t } = useTranslation();
  const urlId = useId();
  const tokenId = useId();
  const look = STATUS_LOOK[status];
  const canRetry = status === "offline" || status === "unauthorized";

  return (
    <StepPage>
      <StepTitle title={t("setup.server.title")} subtitle={t("setup.server.subtitle")} />

      <div className="flex flex-col gap-2">
        <label htmlFor={urlId} className="text-[13px] font-medium">
          {t("setup.server.url")}
        </label>
        <Input
          id={urlId}
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder={t("setup.server.placeholder")}
          autoComplete="off"
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
