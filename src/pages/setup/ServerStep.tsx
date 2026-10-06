import { AlertCircle, Loader2, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ServerStatus } from "@/lib/server";
import { StepTitle } from "./StepTitle";

interface ServerStepProps {
  url: string;
  token: string;
  status: ServerStatus;
  onUrlChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onTest: () => void;
}

export function ServerStep({ url, token, status, onUrlChange, onTokenChange, onTest }: ServerStepProps) {
  const { t } = useTranslation();
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <StepTitle title={t("setup.server.title")} subtitle={t("setup.server.subtitle")} />

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">{t("setup.server.url")}</label>
          <input
            type="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder={t("setup.server.placeholder")}
            className="w-full h-10 px-3 rounded-lg bg-surface-deep border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-active)]"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">{t("setup.server.token")}</label>
          <input
            type="password"
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            placeholder={t("setup.server.tokenPlaceholder")}
            autoComplete="off"
            className="w-full h-10 px-3 rounded-lg bg-surface-deep border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-active)]"
          />
        </div>

        <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card">
          {status === "checking" && <Loader2 className="h-5 w-5 text-[var(--color-active)] animate-spin" />}
          {status === "online" && <Wifi className="h-5 w-5 text-[var(--color-success)]" />}
          {(status === "offline" || status === "unauthorized") && (
            <WifiOff className="h-5 w-5 text-[var(--color-destructive)]" />
          )}
          {status === "unknown" && <AlertCircle className="h-5 w-5 text-muted-foreground" />}

          <span className="flex-1 text-sm">{t(`setup.server.status.${status}`)}</span>

          <Button variant="outline" size="sm" onClick={onTest} disabled={status === "checking"}>
            {t("setup.server.test")}
          </Button>
        </div>
      </div>
    </div>
  );
}
