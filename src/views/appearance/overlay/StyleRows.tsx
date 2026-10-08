import { useTranslation } from "react-i18next";
import type { OverlaySize } from "@/App";
import { formatPercent } from "@/i18n";
import { SettingRow } from "@/components/SettingRow";
import { Range } from "@/components/ui/range";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  FLYOUT_EDGES,
  FLYOUT_MIDDLE_MIN,
  FLYOUT_WIDTH_MAX,
  FLYOUT_WIDTH_MIN,
  SHADOW_MAX,
  VOICES,
  type OverlayLook,
  type OverlayVoice,
  flyoutRoom,
  isCrowded,
  lookReset,
} from "@/lib/overlay";

const SIZES: readonly OverlaySize[] = ["small", "medium", "large"];
/** The size the overlay starts with, as `OverlaySize::default()` has it on the Rust side. */
const DEFAULT_SIZE: OverlaySize = "small";

/** What every row of a style asks for: the look it reads, and the way to change it. */
export interface LookRowProps {
  look: OverlayLook;
  onLook: (patch: Partial<OverlayLook>) => void;
}

export function ShadowRow(props: LookRowProps) {
  const { t } = useTranslation();
  const { look, onLook } = props;
  return (
    <SettingRow onReset={lookReset(look, onLook, "shadow")} label={t("appearance.overlay.colors.shadow")} hint={t("appearance.overlay.colors.shadowHint")}>
      <div className="flex items-center gap-3">
        <Range
          label={t("appearance.overlay.colors.shadow")}
          min={0}
          max={SHADOW_MAX}
          step={10}
          value={look.shadow}
          onChange={(shadow) => onLook({ shadow })}
        />
        <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatPercent(look.shadow / 100)}</span>
      </div>
    </SettingRow>
  );
}

export function SizeRow({ size, onSize }: { size: OverlaySize; onSize: (size: OverlaySize) => void }) {
  const { t } = useTranslation();
  return (
    <SettingRow onReset={size === DEFAULT_SIZE ? undefined : () => onSize(DEFAULT_SIZE)} label={t("appearance.overlay.movement.size")} hint={t("appearance.overlay.movement.sizeHint")}>
      <Segmented
        label={t("appearance.overlay.movement.size")}
        value={size}
        onChange={onSize}
        options={SIZES.map((value) => ({ value, label: t(`appearance.overlay.sizes.${value}`) }))}
      />
    </SettingRow>
  );
}

export function MicRow(props: LookRowProps) {
  const { t } = useTranslation();
  const { look, onLook } = props;
  const crowded = isCrowded(look);
  return (
    <SettingRow
      onReset={lookReset(look, onLook, "mic")}
      label={t("appearance.overlay.movement.mic")}
      hint={crowded ? t("appearance.overlay.movement.noRoom") : t("appearance.overlay.movement.micHint")}
      disabled={crowded}
    >
      <Switch checked={look.mic && !crowded} disabled={crowded} onCheckedChange={(mic) => onLook({ mic })} />
    </SettingRow>
  );
}

export function MarksRow(props: LookRowProps) {
  const { t } = useTranslation();
  const { look, onLook } = props;
  const crowded = isCrowded(look);
  return (
    <SettingRow
      onReset={lookReset(look, onLook, "transcribing_marks")}
      label={t("appearance.overlay.movement.marks")}
      hint={crowded ? t("appearance.overlay.movement.noRoom") : t("appearance.overlay.movement.marksHint")}
      disabled={crowded}
    >
      <Switch checked={look.transcribing_marks && !crowded} disabled={crowded} onCheckedChange={(transcribing_marks) => onLook({ transcribing_marks })} />
    </SettingRow>
  );
}

export function VoiceRow(props: LookRowProps) {
  const { t } = useTranslation();
  const { look, onLook } = props;
  return (
    <SettingRow onReset={lookReset(look, onLook, "voice")} label={t("appearance.overlay.movement.voice")} hint={t("appearance.overlay.movement.voiceHint")}>
      <Segmented
        label={t("appearance.overlay.movement.voice")}
        value={look.voice}
        onChange={(voice: OverlayVoice) => onLook({ voice })}
        options={VOICES.map((value) => ({ value, label: t(`appearance.overlay.movement.voices.${value}`) }))}
      />
    </SettingRow>
  );
}

export function CardWidthRow(props: LookRowProps) {
  const { t } = useTranslation();
  const { look, onLook } = props;
  return (
    <SettingRow onReset={lookReset(look, onLook, "card_width")} label={t("appearance.overlay.movement.cardWidth")} hint={t("appearance.overlay.movement.cardWidthHint")}>
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
  );
}

export function MiddleWidthRow(props: LookRowProps) {
  const { t } = useTranslation();
  const { look, onLook } = props;
  const room = flyoutRoom(look);
  return (
    <SettingRow onReset={lookReset(look, onLook, "middle_width")} label={t("appearance.overlay.movement.middleWidth")} hint={t("appearance.overlay.movement.middleWidthHint")}>
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
  );
}
