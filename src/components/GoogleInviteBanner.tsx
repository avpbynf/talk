import { Cloud, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface GoogleInviteBannerProps {
  busy: boolean;
  failure: string | null;
  onSignIn: () => void;
  onDismiss: () => void;
}

/**
 * A strip under the titlebar inviting the user to sign in with Google, once.
 * Signing in and closing it are both a final answer.
 */
export function GoogleInviteBanner({ busy, failure, onSignIn, onDismiss }: GoogleInviteBannerProps) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-b border-border-subtle bg-surface-raised px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Cloud className="h-4 w-4 shrink-0 text-[var(--color-active)]" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{t("googleInvite.text")}</p>
          {failure && <p className="truncate text-sm text-destructive">{failure}</p>}
        </div>

        <Button size="sm" onClick={onSignIn} disabled={busy}>
          {busy ? t("account.signingIn") : t("account.signIn")}
        </Button>
        <button
          onClick={onDismiss}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-active hover:text-foreground"
          aria-label={t("googleInvite.dismiss")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
