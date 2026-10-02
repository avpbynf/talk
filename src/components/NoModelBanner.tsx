import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface NoModelBannerProps {
  onChoose: () => void;
}

/**
 * Says up front that dictating will not work, rather than letting the first
 * dictation find out. It stays until a model is loaded: there is nothing to
 * dismiss it for, since the shortcut refuses to record until then.
 */
export function NoModelBanner({ onChoose }: NoModelBannerProps) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-b border-border-subtle bg-surface-raised px-4 py-2.5">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-destructive)]" />
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{t("noModelBanner.title")}</span>
          <span className="ml-2 text-muted-foreground">
            {t("noModelBanner.hint")}
          </span>
        </p>
        <Button size="sm" onClick={onChoose}>
          {t("noModelBanner.choose")}
        </Button>
      </div>
    </div>
  );
}
