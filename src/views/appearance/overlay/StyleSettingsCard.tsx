import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OverlaySize } from "@/App";
import { Disclosure } from "@/components/Disclosure";
import { SectionCard } from "@/components/SectionCard";
import { type OverlayLook, type OverlaySettings, lookReset } from "@/lib/overlay";
import type { OverlayThemeId } from "@/lib/overlay-themes";
import type { Stop } from "@/lib/theme";
import PaletteRows from "./PaletteRows";
import { CardWidthRow, MarksRow, MicRow, MiddleWidthRow, ShadowRow, SizeRow, VoiceRow } from "./StyleRows";

interface StyleSettingsCardProps {
  settings: OverlaySettings;
  accent: readonly Stop[];
  onLook: (patch: Partial<OverlayLook>) => void;
  onTheme: (theme: OverlayThemeId) => void;
  onSize: (size: OverlaySize) => void;
}

/** What belongs to the style picked, and to no other: the card is named after it and its rows follow it. */
export default function StyleSettingsCard({ settings, accent, onLook, onTheme, onSize }: StyleSettingsCardProps) {
  const { t } = useTranslation();
  const { look, size } = settings;
  const rows = { look, onLook };

  return (
    <SectionCard icon={Volume2} title={t(`appearance.overlay.style.${look.style}.name`)} subtitle={t("appearance.overlay.own.subtitle")}>
      <PaletteRows settings={settings} accent={accent} onLook={onLook} onTheme={onTheme} />
      {look.style === "flyout" && (
        <>
          <VoiceRow {...rows} />
          <CardWidthRow {...rows} />
          <MicRow {...rows} />
          <MarksRow {...rows} />
          <ShadowRow {...rows} />
          <Disclosure away={lookReset(look, onLook, "middle_width") ? 1 : 0}>
            <MiddleWidthRow {...rows} />
          </Disclosure>
        </>
      )}
      {look.style === "halo" && (
        <>
          <SizeRow size={size} onSize={onSize} />
          <ShadowRow {...rows} />
          <MicRow {...rows} />
          <MarksRow {...rows} />
        </>
      )}
      {look.style === "capsule" && (
        <>
          <SizeRow size={size} onSize={onSize} />
          <ShadowRow {...rows} />
          <MicRow {...rows} />
        </>
      )}
      {look.style === "orb" && <SizeRow size={size} onSize={onSize} />}
    </SectionCard>
  );
}
