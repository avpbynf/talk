import { Computer, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { StepTitle } from "./StepTitle";
import type { TranscriptionMode } from "./types";

interface ModeStepProps {
  mode: TranscriptionMode;
  onChange: (mode: TranscriptionMode) => void;
}

export function ModeStep({ mode, onChange }: ModeStepProps) {
  const { t } = useTranslation();
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <StepTitle title={t("setup.mode.title")} subtitle={t("setup.mode.subtitle")} />

      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => onChange("local")}
          className={cn(
            "p-6 rounded-xl border-2 transition-all text-left",
            mode === "local"
              ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
              : "border-border hover:border-muted-foreground/50"
          )}
        >
          <Computer className="h-8 w-8 mb-3 text-[var(--color-active)]" />
          <h3 className="font-semibold mb-1">{t("setup.mode.local.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("setup.mode.local.description")}</p>
        </button>

        <button
          onClick={() => onChange("server")}
          className={cn(
            "p-6 rounded-xl border-2 transition-all text-left",
            mode === "server"
              ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
              : "border-border hover:border-muted-foreground/50"
          )}
        >
          <Server className="h-8 w-8 mb-3 text-[var(--color-active)]" />
          <h3 className="font-semibold mb-1">{t("setup.mode.server.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("setup.mode.server.description")}</p>
        </button>
      </div>
    </div>
  );
}
