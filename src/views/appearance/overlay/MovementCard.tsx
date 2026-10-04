import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OverlaySize } from "@/App";
import { formatPercent } from "@/i18n";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Range } from "@/components/ui/range";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { type OverlayEntrance, type OverlayLook, REACTION_MAX, REACTION_MIN } from "@/lib/overlay";

const ENTRANCES: readonly OverlayEntrance[] = ["bounce", "slide", "fade"];
const SIZES: readonly OverlaySize[] = ["small", "medium", "large"];

interface MovementCardProps {
  look: OverlayLook;
  size: OverlaySize;
  onLook: (patch: Partial<OverlayLook>) => void;
  onSize: (size: OverlaySize) => void;
}

/** How the overlay moves with the voice and arrives, how large it is, and what it shows. */
export default function MovementCard({ look, size, onLook, onSize }: MovementCardProps) {
  const { t } = useTranslation();

  return (
    <SectionCard icon={Volume2} title={t("appearance.overlay.movement.title")}>
      <SettingRow label={t("appearance.overlay.movement.reaction")} hint={t("appearance.overlay.movement.reactionHint")}>
        <div className="flex items-center gap-3">
          <Range
            label={t("appearance.overlay.movement.reaction")}
            min={REACTION_MIN}
            max={REACTION_MAX}
            step={5}
            value={look.reaction}
            onChange={(reaction) => onLook({ reaction })}
          />
          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatPercent(look.reaction / 100)}</span>
        </div>
      </SettingRow>

      <SettingRow label={t("appearance.overlay.movement.entrance")} hint={t("appearance.overlay.movement.entranceHint")}>
        <Segmented
          label={t("appearance.overlay.movement.entrance")}
          value={look.entrance}
          onChange={(entrance: OverlayEntrance) => onLook({ entrance })}
          options={ENTRANCES.map((value) => ({ value, label: t(`appearance.overlay.movement.${value}`) }))}
        />
      </SettingRow>

      <SettingRow label={t("appearance.overlay.movement.size")} hint={t("appearance.overlay.movement.sizeHint")}>
        <Segmented
          label={t("appearance.overlay.movement.size")}
          value={size}
          onChange={onSize}
          options={SIZES.map((value) => ({ value, label: t(`appearance.overlay.sizes.${value}`) }))}
        />
      </SettingRow>

      <SettingRow label={t("appearance.overlay.movement.timer")}>
        <Switch checked={look.timer} onCheckedChange={(timer) => onLook({ timer })} />
      </SettingRow>

      <SettingRow label={t("appearance.overlay.movement.endText")} hint={t("appearance.overlay.movement.endTextHint")}>
        <Switch checked={look.end_text} onCheckedChange={(end_text) => onLook({ end_text })} />
      </SettingRow>

      <SettingRow label={t("appearance.overlay.movement.mic")} hint={t("appearance.overlay.movement.micHint")}>
        <Switch checked={look.mic} onCheckedChange={(mic) => onLook({ mic })} />
      </SettingRow>
    </SectionCard>
  );
}
