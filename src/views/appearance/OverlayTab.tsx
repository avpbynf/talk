import { useMemo } from "react";
import { LoadGate } from "@/components/LoadGate";
import { overlayColors, surfaceOf } from "@/lib/overlay";
import { modeOf } from "@/lib/theme-contrast";
import { useGoogleAccount } from "@/lib/use-google-account";
import { useOverlaySettings } from "@/lib/use-overlay-settings";
import type { AppThemeController } from "@/lib/use-app-theme";
import ColorsCard from "./overlay/ColorsCard";
import MovementCard from "./overlay/MovementCard";
import PositionCard from "./overlay/PositionCard";
import PreviewCard from "./overlay/PreviewCard";
import StyleCard from "./overlay/StyleCard";

/** The recording overlay: its style, a preview of it, its colours, how it moves and where it appears. */
export default function OverlayTab({ appTheme }: { appTheme: AppThemeController }) {
  const { settings, ready, reload, setLook, setPlacement, setTheme, setSize } = useOverlaySettings();
  const { status } = useGoogleAccount();
  const stops = appTheme.resolved.values.stops;
  const colors = useMemo(() => overlayColors(settings.look, settings.theme, stops), [settings.look, settings.theme, stops]);
  const themeMode = modeOf(appTheme.resolved.values.bg);
  const surface = surfaceOf(settings.look, themeMode);
  const email = status?.available && status.email ? status.email : null;

  // Nothing is drawn from defaults that are about to be replaced by what the backend holds.
  if (!ready) return <LoadGate groups={["overlay"]} onRetry={reload} inline>{null}</LoadGate>;

  return (
    <>
      <StyleCard look={settings.look} themeMode={themeMode} colors={colors} email={email} onChange={(style) => setLook({ style })} />
      <PreviewCard
        settings={settings}
        surface={surface}
        colors={colors}
        email={email}
        onFree={(free) => setPlacement({ spot: "free", free }, true)}
      />
      <ColorsCard settings={settings} accent={stops} onLook={setLook} onTheme={setTheme} />
      <MovementCard look={settings.look} size={settings.size} onLook={setLook} onSize={setSize} />
      <PositionCard placement={settings.placement} onPlacement={setPlacement} />
    </>
  );
}
