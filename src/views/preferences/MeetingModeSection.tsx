import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { AlertCircle, Mic } from "lucide-react";
import { LoadGate } from "@/components/LoadGate";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { isSilent, MEETING_MODE_CHANGED, readMeetingMode, type MeetingMode } from "@/lib/meeting-mode";
import { tell } from "@/lib/notice";
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
      <p className="max-w-[64ch] text-[13px] leading-[1.55] text-muted-foreground">
        {t("preferences.meeting.hint")}{" "}
        {vbCableStatus.installed
          ? t("preferences.meeting.detected", { device: vbCableStatus.device_name })
          : t("preferences.meeting.notInstalled")}
      </p>

      {silent && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
          <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 basis-56 text-muted-foreground" title={mode.failure ?? undefined}>
            {t("preferences.meeting.silent")}
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
        <p className="text-xs text-muted-foreground">{t("preferences.meeting.setup")}</p>
      )}
    </SectionCard>
    </LoadGate>
  );
}
