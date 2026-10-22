import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trans, useTranslation } from "react-i18next";
import { AlertCircle, Loader2, Mic } from "lucide-react";
import { LoadGate } from "@/components/LoadGate";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  CABLE_CONTEXT,
  isSilent,
  MEETING_MODE_CHANGED,
  readMeetingMode,
  type MeetingMode,
} from "@/lib/meeting-mode";
import { tell } from "@/lib/notice";
import { isMac } from "@/lib/platform";
import { useSettingRead } from "@/lib/use-setting-read";

interface VBCableStatus {
  installed: boolean;
  device_name: string | null;
}

const OFF: MeetingMode = { enabled: false, routing: false, microphone: null, failure: null };

export default function MeetingModeSection() {
  const { t } = useTranslation();
  const [vbCableStatus, setVbCableStatus] = useState<VBCableStatus>({
    installed: false,
    device_name: null,
  });
  const [mode, setMode] = useState<MeetingMode>(OFF);
  const [loading, setLoading] = useState(false);

  // The switch stays locked until both are known, and says so with a Retry when they cannot be read.
  const { pending, reload } = useSettingRead(
    "meeting",
    () => Promise.all([invoke<VBCableStatus>("get_vbcable_status"), readMeetingMode()]),
    ([status, read]) => {
      setVbCableStatus(status);
      setMode(read);
    },
    ["settings-synced", MEETING_MODE_CHANGED],
  );

  // On a Mac the user installs BlackHole by hand, out of Talk, so coming back to the window looks
  // for it again instead of leaving the switch locked until the page is opened anew.
  useEffect(() => {
    if (!isMac) return;
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  const handleToggle = async (enabled: boolean) => {
    setLoading(true);
    try {
      await invoke("set_meeting_mode", { enabled });
    } catch (err) {
      console.error("Failed to toggle meeting mode:", err);
      tell(t("preferences.meeting.refused"));
    } finally {
      setLoading(false);
      reload();
    }
  };

  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const installBlackHole = async () => {
    setInstalling(true);
    setInstallError(null);
    try {
      await invoke("install_blackhole");
    } catch (err) {
      // A password dialog closed on purpose is a choice, not something to report.
      if (String(err) !== "declined") setInstallError(String(err));
    } finally {
      setInstalling(false);
      reload();
    }
  };

  const silent = isSilent(mode);

  return (
    <LoadGate groups={["meeting"]} onRetry={reload} pending={pending} inline>
    <SectionCard
      icon={Mic}
      title={t("preferences.meeting.title")}
      action={
        <Switch
          checked={mode.enabled}
          onCheckedChange={handleToggle}
          disabled={!vbCableStatus.installed || loading}
          aria-label={t("preferences.meeting.title")}
        />
      }
    >
      {/* A row of the card, so the line under it spans the card while the text stays short. */}
      <div>
        <p className="max-w-[64ch] text-[13px] leading-[1.55] text-muted-foreground">
          {t("preferences.meeting.hint", { context: CABLE_CONTEXT })}{" "}
          {vbCableStatus.installed
            ? t("preferences.meeting.detected", { context: CABLE_CONTEXT, device: vbCableStatus.device_name })
            : t("preferences.meeting.notInstalled", { context: CABLE_CONTEXT })}
        </p>
      </div>

      {/* Windows has VB-Cable from the installer. BlackHole is not bundled, so a Mac offers to
          fetch it from its maker and install it, the terminal staying the way round. */}
      {isMac && !vbCableStatus.installed && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={installing} onClick={installBlackHole}>
              {installing && <Loader2 className="animate-spin" />}
              {t(installing ? "preferences.meeting.installing" : "preferences.meeting.install")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("preferences.meeting.installNote")}</span>
          </div>
          {installError && (
            <p role="alert" className="text-xs text-[var(--color-destructive)]">
              {t("preferences.meeting.installFailed", { error: installError })}
            </p>
          )}
          <p className="max-w-[64ch] text-xs leading-[1.55] text-muted-foreground">
            <Trans
              i18nKey="preferences.meeting.installMac"
              components={{ cmd: <code className="rounded bg-muted px-1 py-px font-mono text-[11px] text-foreground select-text" /> }}
            />
          </p>
        </div>
      )}

      {silent && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
          <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 basis-56 text-muted-foreground" title={mode.failure ?? undefined}>
            {t("preferences.meeting.silent", { context: CABLE_CONTEXT })}
          </span>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => handleToggle(true)}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {mode.routing && mode.microphone && (
        <p className="text-xs text-muted-foreground">
          {t("preferences.meeting.routing", { microphone: mode.microphone })}
        </p>
      )}

      {vbCableStatus.installed && (
        <p className="text-xs text-muted-foreground">
          {t("preferences.meeting.setup", { context: CABLE_CONTEXT, device: vbCableStatus.device_name })}
        </p>
      )}
    </SectionCard>
    </LoadGate>
  );
}
