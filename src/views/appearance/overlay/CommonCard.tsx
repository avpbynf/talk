import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatNumber, formatPercent } from "@/i18n";
import { Disclosure } from "@/components/Disclosure";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Range } from "@/components/ui/range";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  ENTRANCE_SIDES,
  PASTED_HOLD_MAX_MS,
  REACTION_MAX,
  REACTION_MIN,
  type OverlayEntrance,
  type OverlayEntranceFrom,
  type OverlayLook,
  type OverlayTone,
  isCrowded,
  lookReset,
} from "@/lib/overlay";

const TONES: readonly OverlayTone[] = ["theme", "dark", "light"];
const ENTRANCES: readonly OverlayEntrance[] = ["bounce", "slide", "fade"];

interface CommonCardProps {
  look: OverlayLook;
  onLook: (patch: Partial<OverlayLook>) => void;
}

/** What the four styles share: the background, how the overlay arrives and reacts, and what it says at the end. */
export default function CommonCard({ look, onLook }: CommonCardProps) {
  const { t } = useTranslation();
  const reset = (...keys: (keyof OverlayLook)[]) => lookReset(look, onLook, ...keys);
  // A Windows card made too narrow keeps only its middle: the timer has no place left.
  const crowded = isCrowded(look);

  return (
    <SectionCard icon={Palette} title={t("appearance.overlay.common.title")} subtitle={t("appearance.overlay.common.subtitle")}>
      <SettingRow onReset={reset("tone")} label={t("appearance.overlay.colors.background")}>
        <Segmented
          label={t("appearance.overlay.colors.background")}
          value={look.tone}
          onChange={(tone: OverlayTone) => onLook({ tone })}
          options={TONES.map((value) => ({ value, label: t(`appearance.overlay.colors.${value}`) }))}
        />
      </SettingRow>

      <SettingRow onReset={reset("opacity")} label={t("appearance.overlay.colors.opacity")} hint={t("appearance.overlay.colors.opacityHint")}>
        <div className="flex items-center gap-3">
          <Range
            label={t("appearance.overlay.colors.opacity")}
            min={0}
            max={100}
            step={5}
            value={look.opacity}
            onChange={(opacity) => onLook({ opacity })}
          />
          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatPercent(look.opacity / 100)}</span>
        </div>
      </SettingRow>

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

      <SettingRow
        onReset={reset("timer")}
        label={t("appearance.overlay.movement.timer")}
        hint={crowded ? t("appearance.overlay.movement.noRoom") : undefined}
        disabled={crowded}
      >
        <Switch checked={look.timer && !crowded} disabled={crowded} onCheckedChange={(timer) => onLook({ timer })} />
      </SettingRow>

      <SettingRow onReset={reset("end_text")} label={t("appearance.overlay.movement.endText")} hint={t("appearance.overlay.movement.endTextHint")}>
        <Switch checked={look.end_text} onCheckedChange={(end_text) => onLook({ end_text })} />
      </SettingRow>

      <Disclosure away={reset("pasted_hold_ms") ? 1 : 0}>
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
      </Disclosure>
    </SectionCard>
  );
}
