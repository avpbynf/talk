import { useTranslation } from "react-i18next";
import { RecordingMode } from "@/App";
import type { CompanionShortcut } from "@/App";
import { ScrollArea } from "@/components/ui/scroll-area";
import AudioDevicesSection from "./preferences/AudioDevicesSection";
import RecordingModeSection from "./preferences/RecordingModeSection";
import ShortcutsSection from "./preferences/ShortcutsSection";
import ChainedDictationsSection from "./preferences/ChainedDictationsSection";
import CompanionShortcutsSection from "./preferences/CompanionShortcutsSection";
import MeetingModeSection from "./preferences/MeetingModeSection";
import SoundFeedbackSection from "./preferences/SoundFeedbackSection";
import SystemSection from "./preferences/SystemSection";
import LanguageSection from "./preferences/LanguageSection";
import UpdatesSection from "./preferences/UpdatesSection";
import type { Updater } from "@/lib/use-updater";

interface PreferencesViewProps {
  recordingMode: RecordingMode;
  onRecordingModeChange: (mode: RecordingMode) => void;
  shortcut: string;
  onShortcutChange: (shortcut: string) => Promise<void>;
  cancelShortcut: string;
  onCancelShortcutChange: (shortcut: string) => Promise<void>;
  pasteShortcut: string;
  onPasteShortcutChange: (shortcut: string) => Promise<void>;
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
  companionShortcuts: CompanionShortcut[];
  onCompanionShortcutsChange: (shortcuts: CompanionShortcut[]) => void;
  soundFeedback: boolean;
  onSoundFeedbackChange: (enabled: boolean) => void;
  startSound: string;
  onStartSoundChange: (preset: string) => void;
  stopSound: string;
  onStopSoundChange: (preset: string) => void;
  updater: Updater;
}

export default function PreferencesView({
  recordingMode,
  onRecordingModeChange,
  shortcut,
  onShortcutChange,
  cancelShortcut,
  onCancelShortcutChange,
  pasteShortcut,
  onPasteShortcutChange,
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
  companionShortcuts,
  onCompanionShortcutsChange,
  soundFeedback,
  onSoundFeedbackChange,
  startSound,
  onStartSoundChange,
  stopSound,
  onStopSoundChange,
  updater,
}: PreferencesViewProps) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Page title */}
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{t("preferences.title")}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("preferences.subtitle")}
              </p>
            </div>

            {/* Separator */}
            <div className="h-px bg-border-subtle" />

            <AudioDevicesSection />
            <RecordingModeSection
              recordingMode={recordingMode}
              onRecordingModeChange={onRecordingModeChange}
            />
            <ShortcutsSection
              shortcut={shortcut}
              onShortcutChange={onShortcutChange}
              cancelShortcut={cancelShortcut}
              onCancelShortcutChange={onCancelShortcutChange}
              pasteShortcut={pasteShortcut}
              onPasteShortcutChange={onPasteShortcutChange}
              recordingMode={recordingMode}
            />
            <ChainedDictationsSection />
            <SoundFeedbackSection
              soundFeedback={soundFeedback}
              onSoundFeedbackChange={onSoundFeedbackChange}
              startSound={startSound}
              onStartSoundChange={onStartSoundChange}
              stopSound={stopSound}
              onStopSoundChange={onStopSoundChange}
            />
            <MeetingModeSection />
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
            <CompanionShortcutsSection
              companionShortcuts={companionShortcuts}
              onCompanionShortcutsChange={onCompanionShortcutsChange}
            />
            {/* Last on the page, whatever is added above it */}
            <UpdatesSection updater={updater} />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
