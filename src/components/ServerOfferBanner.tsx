import { Radar, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { DiscoveredServer } from "@/lib/server";

interface ServerOfferBannerProps {
  server: DiscoveredServer;
  onUse: (server: DiscoveredServer) => void;
  onDismiss: () => void;
}

/**
 * A strip under the titlebar, shown once for a server found on the network
 * while dictation runs on this machine. Answering it either way, or ignoring
 * it, is the only time that server is offered.
 */
export function ServerOfferBanner({ server, onUse, onDismiss }: ServerOfferBannerProps) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-b border-border-subtle bg-surface-raised px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Radar className="h-4 w-4 shrink-0 text-[var(--color-server)]" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            <span className="font-medium">{t("serverOffer.found", { name: server.name })}</span>
            <span className="ml-2 text-muted-foreground">
              {server.model ? `${server.model}, ` : ""}
              {server.url}
            </span>
          </p>
        </div>

        <Button size="sm" onClick={() => onUse(server)}>
          {t("serverOffer.use")}
        </Button>
        <button
          onClick={onDismiss}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-active hover:text-foreground"
          aria-label={t("serverOffer.dismiss")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
