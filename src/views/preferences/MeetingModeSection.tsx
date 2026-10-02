import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Radio } from "lucide-react";

interface VBCableStatus {
  installed: boolean;
  device_name: string | null;
}

export default function MeetingModeSection() {
  const { t } = useTranslation();
  const [vbCableStatus, setVbCableStatus] = useState<VBCableStatus>({
    installed: false,
    device_name: null,
  });
  const [meetingMode, setMeetingMode] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    invoke<VBCableStatus>("get_vbcable_status").then(setVbCableStatus);
    invoke<boolean>("get_meeting_mode").then(setMeetingMode);

    const unlisten = listen<boolean>("meeting-mode-changed", (e) => {
      setMeetingMode(e.payload);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleToggle = async (enabled: boolean) => {
    setLoading(true);
    try {
      await invoke("set_meeting_mode", { enabled });
      setMeetingMode(enabled);
    } catch (err) {
      console.error("Failed to toggle meeting mode:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
          <Radio className="h-4 w-4" />
          {t("preferences.meeting.title")}
        </div>

        {/* VB-Cable status indicator */}
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              vbCableStatus.installed ? "bg-success" : "bg-destructive"
            }`}
          />
          <span className="text-xs text-muted-foreground">
            {vbCableStatus.installed
              ? t("preferences.meeting.detected", { device: vbCableStatus.device_name })
              : t("preferences.meeting.notInstalled")}
          </span>
        </div>

        {/* Meeting mode toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label
              className={`text-sm font-medium ${!vbCableStatus.installed ? "opacity-50" : ""}`}
            >
              {t("preferences.meeting.title")}
            </label>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("preferences.meeting.hint")}
            </p>
          </div>
          <Switch
            checked={meetingMode}
            onCheckedChange={handleToggle}
            disabled={!vbCableStatus.installed || loading}
          />
        </div>

        {vbCableStatus.installed && (
          <p className="text-xs text-muted-foreground border-t border-border-subtle pt-3">
            {t("preferences.meeting.setup")}
          </p>
        )}
      </div>
    </>
  );
}
