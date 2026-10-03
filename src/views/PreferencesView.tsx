import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import AudioDevicesSection from "./preferences/AudioDevicesSection";
import SystemSection from "./preferences/SystemSection";
import LanguageSection from "./preferences/LanguageSection";
import AccountSection from "./preferences/AccountSection";
import UpdatesSection from "./preferences/UpdatesSection";
import type { Updater } from "@/lib/use-updater";

interface PreferencesViewProps {
  autostartEnabled: boolean;
  onAutostartChange: (enabled: boolean) => void;
  startMinimized: boolean;
  onStartMinimizedChange: (enabled: boolean) => void;
  duckAudioOnRecord: boolean;
  onDuckAudioOnRecordChange: (enabled: boolean) => void;
  duckVolumePercent: number;
  onDuckVolumePercentChange: (percent: number) => void;
  preserveClipboard: boolean;
  onPreserveClipboardChange: (enabled: boolean) => void;
  updater: Updater;
}

export default function PreferencesView({
  autostartEnabled,
  onAutostartChange,
  startMinimized,
  onStartMinimizedChange,
  duckAudioOnRecord,
  onDuckAudioOnRecordChange,
  duckVolumePercent,
  onDuckVolumePercentChange,
  preserveClipboard,
  onPreserveClipboardChange,
  updater,
}: PreferencesViewProps) {
  const { t } = useTranslation();
  return (
    <PageShell title={t("preferences.title")} subtitle={t("preferences.subtitle")}>
      <AudioDevicesSection />
      <SystemSection
        autostartEnabled={autostartEnabled}
        onAutostartChange={onAutostartChange}
        startMinimized={startMinimized}
        onStartMinimizedChange={onStartMinimizedChange}
        duckAudioOnRecord={duckAudioOnRecord}
        onDuckAudioOnRecordChange={onDuckAudioOnRecordChange}
        duckVolumePercent={duckVolumePercent}
        onDuckVolumePercentChange={onDuckVolumePercentChange}
        preserveClipboard={preserveClipboard}
        onPreserveClipboardChange={onPreserveClipboardChange}
      />
      <LanguageSection />
      <AccountSection />
      {/* Last on the page, whatever is added above it */}
      <UpdatesSection updater={updater} />
    </PageShell>
  );
}
