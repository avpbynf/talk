import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, Share2, Trash2 } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/SectionCard";
import { cn } from "@/lib/utils";
import { describeShare, useShare } from "@/lib/share";
import { locale } from "@/i18n";

interface SharePanelProps {
  currentModel: string | null;
}

function formatWhen(iso: string | null, t: TFunction): string {
  if (!iso) return t("transcription.share.neverUsed");
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? t("transcription.share.neverUsed")
    : t("transcription.share.lastUsed", { when: date.toLocaleString(locale()) });
}

/** Serve the local engine to other machines, which pair with a code. */
export function SharePanel({ currentModel }: SharePanelProps) {
  const { t } = useTranslation();
  const { info, devices, setEnabled, setPort, revoke } = useShare(currentModel);
  const [portInput, setPortInput] = useState("8000");
  const [portError, setPortError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (info) setPortInput(String(info.port));
  }, [info?.port]);

  if (!info) return null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await setEnabled(enabled);
    } catch (e) {
      console.error("Failed to change sharing:", e);
    } finally {
      setBusy(false);
    }
  };

  const savePort = async () => {
    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setPortError(t("transcription.share.portRange"));
      return;
    }
    setPortError(null);
    if (port === info.port) return;
    setBusy(true);
    try {
      await setPort(port);
    } catch (e) {
      setPortError(typeof e === "string" ? e : t("transcription.share.portFailed"));
    } finally {
      setBusy(false);
    }
  };

  const serving = info.state === "serving";
  const failed = info.state === "port_busy" || info.state === "error";
  const statusClass = failed
    ? "text-[var(--color-destructive)]"
    : serving && info.model
      ? "text-[var(--color-success)]"
      : "text-muted-foreground";

  return (
    <SectionCard
      icon={Share2}
      accent="active"
      title={t("transcription.share.title")}
      description={t("transcription.share.subtitle")}
      action={
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch
            checked={info.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => void toggle(enabled)}
            aria-label={t("transcription.share.title")}
          />
        </div>
      }
    >
      {info.enabled && (
        <div className="space-y-1.5 text-xs">
          <p className={cn("flex items-center gap-1.5 font-medium", statusClass)}>
            {failed ? <AlertCircle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {describeShare(info, t)}
          </p>
          {info.message && <p className="text-[var(--color-destructive)]">{info.message}</p>}
          {serving && !info.model && (
            <p className="text-muted-foreground">
              {t("transcription.share.loadModel")}
            </p>
          )}
          {serving && info.address && (
            <p className="text-muted-foreground">
              <Trans
                i18nKey="transcription.share.reachAt"
                values={{ address: info.address }}
                components={{ address: <span className="tabular-nums text-foreground" /> }}
              />
            </p>
          )}
          {serving && info.announceError && (
            <p className="text-muted-foreground">{info.announceError}</p>
          )}
          {serving && info.pairingLocked && (
            <p className="text-[var(--color-destructive)]">
              {t("transcription.share.locked")}
            </p>
          )}
        </div>
      )}

      {info.enabled && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="share-port" className="text-xs font-medium text-muted-foreground">
              {t("transcription.share.port")}
            </label>
            <Input
              id="share-port"
              inputMode="numeric"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value.replace(/\D/g, ""))}
              onBlur={() => void savePort()}
              onKeyDown={(e) => e.key === "Enter" && void savePort()}
              className="h-8 w-24 text-right text-xs tabular-nums"
            />
          </div>
          {portError && (
            <p role="alert" className="text-xs text-[var(--color-destructive)]">
              {portError}
            </p>
          )}
        </div>
      )}

      {(info.enabled || devices.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("transcription.share.paired")}</p>
          {devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("transcription.share.noneYet")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-inset px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{device.name}</p>
                    <p className="text-xs text-muted-foreground">{formatWhen(device.lastUsedAt, t)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void revoke(device.id)}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 />
                    {t("transcription.share.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}
