import { useTranslation } from "react-i18next";
import type { OverlaySize } from "@/App";
import type { OverlayThemeId } from "@/lib/overlay-themes";
import type { AppThemeId } from "@/lib/app-themes";
import { PageShell } from "@/components/PageShell";
import OverlaySection from "./preferences/OverlaySection";
import ThemeSection from "./preferences/ThemeSection";

interface AppearanceViewProps {
  overlayTheme: OverlayThemeId;
  onOverlayThemeChange: (theme: OverlayThemeId) => void;
  overlaySize: OverlaySize;
  onOverlaySizeChange: (size: OverlaySize) => void;
  appTheme: AppThemeId;
  onAppThemeChange: (theme: AppThemeId) => void;
}

export default function AppearanceView({
  overlayTheme,
  onOverlayThemeChange,
  overlaySize,
  onOverlaySizeChange,
  appTheme,
  onAppThemeChange,
}: AppearanceViewProps) {
  const { t } = useTranslation();
  return (
    <PageShell title={t("appearance.title")} subtitle={t("appearance.subtitle")}>
      <OverlaySection
        overlayTheme={overlayTheme}
        onOverlayThemeChange={onOverlayThemeChange}
        overlaySize={overlaySize}
        onOverlaySizeChange={onOverlaySizeChange}
      />

      <ThemeSection appTheme={appTheme} onAppThemeChange={onAppThemeChange} />
    </PageShell>
  );
}
