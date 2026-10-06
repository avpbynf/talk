import { RecordingMode } from "@/App";
import type { CompanionShortcut } from "@/App";
import { PageShell } from "@/components/PageShell";
import ShortcutsSection from "./preferences/ShortcutsSection";
import RecordingModeSection from "./preferences/RecordingModeSection";
import ChainedDictationsSection from "./preferences/ChainedDictationsSection";
import SoundFeedbackSection from "./preferences/SoundFeedbackSection";
import CompanionShortcutsSection from "./preferences/CompanionShortcutsSection";
import MeetingModeSection from "./preferences/MeetingModeSection";

interface DictationViewProps {
  recordingMode: RecordingMode;
  onRecordingModeChange: (mode: RecordingMode) => void;
  shortcut: string;
  onShortcutChange: (shortcut: string) => Promise<void>;
  cancelShortcut: string;
  onCancelShortcutChange: (shortcut: string) => Promise<void>;
  pasteShortcut: string;
  onPasteShortcutChange: (shortcut: string) => Promise<void>;
  companionShortcuts: CompanionShortcut[];
  onCompanionShortcutsChange: (shortcuts: CompanionShortcut[]) => void;
  soundFeedback: boolean;
  onSoundFeedbackChange: (enabled: boolean) => void;
  startSound: string;
  onStartSoundChange: (preset: string) => void;
  stopSound: string;
  onStopSoundChange: (preset: string) => void;
}

export default function DictationView({
  recordingMode,
  onRecordingModeChange,
  shortcut,
  onShortcutChange,
  cancelShortcut,
  onCancelShortcutChange,
  pasteShortcut,
  onPasteShortcutChange,
  companionShortcuts,
  onCompanionShortcutsChange,
  soundFeedback,
  onSoundFeedbackChange,
  startSound,
  onStartSoundChange,
  stopSound,
  onStopSoundChange,
}: DictationViewProps) {
  return (
    <PageShell>
      <ShortcutsSection
        shortcut={shortcut}
        onShortcutChange={onShortcutChange}
        cancelShortcut={cancelShortcut}
        onCancelShortcutChange={onCancelShortcutChange}
        pasteShortcut={pasteShortcut}
        onPasteShortcutChange={onPasteShortcutChange}
        recordingMode={recordingMode}
      />
      <RecordingModeSection
        recordingMode={recordingMode}
        onRecordingModeChange={onRecordingModeChange}
      />
      <MeetingModeSection />
      <ChainedDictationsSection />
      <SoundFeedbackSection
        soundFeedback={soundFeedback}
        onSoundFeedbackChange={onSoundFeedbackChange}
        startSound={startSound}
        onStartSoundChange={onStartSoundChange}
        stopSound={stopSound}
        onStopSoundChange={onStopSoundChange}
      />
      <CompanionShortcutsSection
        companionShortcuts={companionShortcuts}
        onCompanionShortcutsChange={onCompanionShortcutsChange}
      />
    </PageShell>
  );
}
