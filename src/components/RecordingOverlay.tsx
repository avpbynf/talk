import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface RecordingOverlayProps {
  isRecording: boolean;
}

function Waveform() {
  return (
    <div className="flex items-center gap-1 h-8">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="w-1 bg-recording rounded-full wave-bar"
          style={{
            height: "100%",
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function RecordingOverlay({ isRecording }: RecordingOverlayProps) {
  const { t } = useTranslation();
  const [isMinimized, setIsMinimized] = useState(false);

  if (!isRecording) return null;

  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="fixed top-4 right-4 z-50 p-2 rounded-full bg-recording/90 backdrop-blur-sm shadow-lg recording-pulse"
        title={t("overlay.recording")}
      >
        <div className="h-3 w-3 rounded-full bg-white animate-pulse" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed top-4 right-4 z-50",
        "flex items-center gap-3 px-4 py-2",
        "bg-background/90 backdrop-blur-sm",
        "border border-recording/50 rounded-lg shadow-lg",
        "transition-all duration-200"
      )}
    >
      {/* Recording indicator */}
      <div className="h-2 w-2 rounded-full bg-recording recording-pulse" />

      {/* Waveform */}
      <Waveform />

      {/* Recording text */}
      <span className="text-sm font-medium text-recording">{t("overlay.recording")}</span>

      {/* Minimize button */}
      <button
        onClick={() => setIsMinimized(true)}
        className="p-1 hover:bg-muted rounded"
        title={t("overlay.minimize")}
      >
        <X className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}
