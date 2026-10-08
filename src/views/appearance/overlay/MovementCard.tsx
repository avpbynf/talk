import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OverlaySize } from "@/App";
import { formatNumber, formatPercent } from "@/i18n";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Range } from "@/components/ui/range";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { type OverlayEntrance, type OverlayLook, type OverlayVoice, PASTED_HOLD_MAX_MS, REACTION_MAX, REACTION_MIN, VOICES, ENTRANCE_SIDES, type OverlayEntranceFrom, FLYOUT_EDGES, lookReset, FLYOUT_MIDDLE_MIN, FLYOUT_WIDTH_MAX, FLYOUT_WIDTH_MIN, flyoutRoom } from "@/lib/overlay";

const ENTRANCES: readonly OverlayEntrance[] = ["bounce", "slide", "fade"];
const SIZES: readonly OverlaySize[] = ["small", "medium", "large"];
/** The size the overlay starts with, as `OverlaySize::default()` has it on the Rust side. */
const DEFAULT_SIZE: OverlaySize = "small";

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
  const reset = (...keys: (keyof OverlayLook)[]) => lookReset(look, onLook, ...keys);
  // A card made too narrow keeps only its middle: the icon, the timer and the ring have no place left.
  const room = flyoutRoom(look);
  const crowded = system && !room.sides;
  const noRoom = crowded ? t("appearance.overlay.movement.noRoom") : undefined;

  return (
    <SectionCard icon={Volume2} title={t("appearance.overlay.movement.title")}>
      <SettingRow onReset={reset("reaction")} label={t("appearance.overlay.movement.reaction")} hint={t("appearance.overlay.movement.reactionHint")}>
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
        <SettingRow onReset={reset("voice")} label={t("appearance.overlay.movement.voice")} hint={t("appearance.overlay.movement.voiceHint")}>
          <Segmented
            label={t("appearance.overlay.movement.voice")}
            value={look.voice}
            onChange={(voice: OverlayVoice) => onLook({ voice })}
            options={VOICES.map((value) => ({ value, label: t(`appearance.overlay.movement.voices.${value}`) }))}
          />
        </SettingRow>
      )}

      {system && (
        <SettingRow onReset={reset("card_width")} label={t("appearance.overlay.movement.cardWidth")} hint={t("appearance.overlay.movement.cardWidthHint")}>
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
        <SettingRow onReset={reset("middle_width")} label={t("appearance.overlay.movement.middleWidth")} hint={t("appearance.overlay.movement.middleWidthHint")}>
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

      <SettingRow onReset={reset("entrance")} label={t("appearance.overlay.movement.entrance")} hint={t("appearance.overlay.movement.entranceHint")}>
        <Segmented
          label={t("appearance.overlay.movement.entrance")}
          value={look.entrance}
          onChange={(entrance: OverlayEntrance) => onLook({ entrance })}
          options={ENTRANCES.map((value) => ({ value, label: t(`appearance.overlay.movement.${value}`) }))}
        />
      </SettingRow>

      <SettingRow
        onReset={reset("entrance_from")}
        label={t("appearance.overlay.movement.entranceFrom")}
        hint={t(look.entrance === "fade" ? "appearance.overlay.movement.entranceFromNone" : "appearance.overlay.movement.entranceFromHint")}
        disabled={look.entrance === "fade"}
      >
        <Segmented
          label={t("appearance.overlay.movement.entranceFrom")}
          value={look.entrance_from}
          onChange={(entrance_from: OverlayEntranceFrom) => onLook({ entrance_from })}
          options={ENTRANCE_SIDES.map((value) => ({ value, label: t(`appearance.overlay.movement.sides.${value}`) }))}
        />
      </SettingRow>

      {!system && (
        <SettingRow onReset={size === DEFAULT_SIZE ? undefined : () => onSize(DEFAULT_SIZE)} label={t("appearance.overlay.movement.size")} hint={t("appearance.overlay.movement.sizeHint")}>
          <Segmented
            label={t("appearance.overlay.movement.size")}
            value={size}
            onChange={onSize}
            options={SIZES.map((value) => ({ value, label: t(`appearance.overlay.sizes.${value}`) }))}
          />
        </SettingRow>
      )}

      <SettingRow onReset={reset("pasted_hold_ms")} label={t("appearance.overlay.movement.pastedHold")} hint={t("appearance.overlay.movement.pastedHoldHint")}>
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

      <SettingRow onReset={reset("timer")} label={t("appearance.overlay.movement.timer")} hint={noRoom} disabled={crowded}>
        <Switch checked={look.timer && !crowded} disabled={crowded} onCheckedChange={(timer) => onLook({ timer })} />
      </SettingRow>

      <SettingRow onReset={reset("end_text")} label={t("appearance.overlay.movement.endText")} hint={t("appearance.overlay.movement.endTextHint")}>
        <Switch checked={look.end_text} onCheckedChange={(end_text) => onLook({ end_text })} />
      </SettingRow>

      <SettingRow onReset={reset("mic")} label={t("appearance.overlay.movement.mic")} hint={noRoom ?? t("appearance.overlay.movement.micHint")} disabled={crowded}>
        <Switch checked={look.mic && !crowded} disabled={crowded} onCheckedChange={(mic) => onLook({ mic })} />
      </SettingRow>

      <SettingRow onReset={reset("transcribing_marks")} label={t("appearance.overlay.movement.marks")} hint={noRoom ?? t("appearance.overlay.movement.marksHint")} disabled={crowded}>
        <Switch checked={look.transcribing_marks && !crowded} disabled={crowded} onCheckedChange={(transcribing_marks) => onLook({ transcribing_marks })} />
      </SettingRow>
    </SectionCard>
  );
}
