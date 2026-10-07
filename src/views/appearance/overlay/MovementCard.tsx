import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OverlaySize } from "@/App";
import { formatNumber, formatPercent } from "@/i18n";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Range } from "@/components/ui/range";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { type OverlayEntrance, type OverlayLook, type OverlayVoice, PASTED_HOLD_MAX_MS, REACTION_MAX, REACTION_MIN, VOICES, FLYOUT_EDGES, FLYOUT_MIDDLE_MIN, FLYOUT_WIDTH_MAX, FLYOUT_WIDTH_MIN, flyoutRoom } from "@/lib/overlay";

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
  // The Windows style is the system's flyout: it has its size.
  const system = look.style === "flyout";
  // A card made too narrow keeps only its middle: the icon, the timer and the ring have no place left.
  const room = flyoutRoom(look);
  const crowded = system && !room.sides;
  const noRoom = crowded ? t("appearance.overlay.movement.noRoom") : undefined;

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

      {system && (
        <SettingRow label={t("appearance.overlay.movement.voice")} hint={t("appearance.overlay.movement.voiceHint")}>
          <Segmented
            label={t("appearance.overlay.movement.voice")}
            value={look.voice}
            onChange={(voice: OverlayVoice) => onLook({ voice })}
            options={VOICES.map((value) => ({ value, label: t(`appearance.overlay.movement.voices.${value}`) }))}
          />
        </SettingRow>
      )}

      {system && (
        <SettingRow label={t("appearance.overlay.movement.cardWidth")} hint={t("appearance.overlay.movement.cardWidthHint")}>
          <div className="flex items-center gap-3">
            <Range
              label={t("appearance.overlay.movement.cardWidth")}
              min={FLYOUT_WIDTH_MIN}
              max={FLYOUT_WIDTH_MAX}
              step={2}
              value={look.card_width}
              onChange={(card_width) => onLook({ card_width })}
            />
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{t("appearance.overlay.movement.pixels", { value: look.card_width })}</span>
          </div>
        </SettingRow>
      )}

      {system && (
        <SettingRow label={t("appearance.overlay.movement.middleWidth")} hint={t("appearance.overlay.movement.middleWidthHint")}>
          <div className="flex items-center gap-3">
            <Range
              label={t("appearance.overlay.movement.middleWidth")}
              min={FLYOUT_MIDDLE_MIN}
              max={room.card - FLYOUT_EDGES}
              step={2}
              value={room.middle}
              onChange={(middle_width) => onLook({ middle_width })}
            />
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{t("appearance.overlay.movement.pixels", { value: room.middle })}</span>
          </div>
        </SettingRow>
      )}

      <SettingRow label={t("appearance.overlay.movement.entrance")} hint={t("appearance.overlay.movement.entranceHint")}>
        <Segmented
          label={t("appearance.overlay.movement.entrance")}
          value={look.entrance}
          onChange={(entrance: OverlayEntrance) => onLook({ entrance })}
          options={ENTRANCES.map((value) => ({ value, label: t(`appearance.overlay.movement.${value}`) }))}
        />
      </SettingRow>

      {!system && (
        <SettingRow label={t("appearance.overlay.movement.size")} hint={t("appearance.overlay.movement.sizeHint")}>
          <Segmented
            label={t("appearance.overlay.movement.size")}
            value={size}
            onChange={onSize}
            options={SIZES.map((value) => ({ value, label: t(`appearance.overlay.sizes.${value}`) }))}
          />
        </SettingRow>
      )}

      <SettingRow label={t("appearance.overlay.movement.pastedHold")} hint={t("appearance.overlay.movement.pastedHoldHint")}>
        <div className="flex items-center gap-3">
          <Range
            label={t("appearance.overlay.movement.pastedHold")}
            min={0}
            max={PASTED_HOLD_MAX_MS}
            step={250}
            value={look.pasted_hold_ms}
            onChange={(pasted_hold_ms) => onLook({ pasted_hold_ms })}
          />
          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
            {t("appearance.overlay.movement.seconds", { value: formatNumber(look.pasted_hold_ms / 1000, 2) })}
          </span>
        </div>
      </SettingRow>

      <SettingRow label={t("appearance.overlay.movement.timer")} hint={noRoom} disabled={crowded}>
        <Switch checked={look.timer && !crowded} disabled={crowded} onCheckedChange={(timer) => onLook({ timer })} />
      </SettingRow>

      <SettingRow label={t("appearance.overlay.movement.endText")} hint={t("appearance.overlay.movement.endTextHint")}>
        <Switch checked={look.end_text} onCheckedChange={(end_text) => onLook({ end_text })} />
      </SettingRow>

      <SettingRow label={t("appearance.overlay.movement.mic")} hint={noRoom ?? t("appearance.overlay.movement.micHint")} disabled={crowded}>
        <Switch checked={look.mic && !crowded} disabled={crowded} onCheckedChange={(mic) => onLook({ mic })} />
      </SettingRow>

      <SettingRow label={t("appearance.overlay.movement.marks")} hint={noRoom ?? t("appearance.overlay.movement.marksHint")} disabled={crowded}>
        <Switch checked={look.transcribing_marks && !crowded} disabled={crowded} onCheckedChange={(transcribing_marks) => onLook({ transcribing_marks })} />
      </SettingRow>
    </SectionCard>
  );
}
