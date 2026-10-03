import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OverlaySize } from "@/App";
import type { OverlayThemeId } from "@/lib/overlay-themes";
import type { AppThemeController } from "@/lib/use-app-theme";
import { PageShell } from "@/components/PageShell";
import { Segmented } from "@/components/ui/segmented";
import OverlaySection from "./preferences/OverlaySection";
import PresetGrid from "./appearance/PresetGrid";

interface AppearanceViewProps {
  overlayTheme: OverlayThemeId;
  onOverlayThemeChange: (theme: OverlayThemeId) => void;
  overlaySize: OverlaySize;
  onOverlaySizeChange: (size: OverlaySize) => void;
  appTheme: AppThemeController;
}

type Tab = "application" | "overlay";

export default function AppearanceView({
  overlayTheme,
  onOverlayThemeChange,
  overlaySize,
  onOverlaySizeChange,
  appTheme,
}: AppearanceViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("application");

  return (
    <PageShell title={t("appearance.title")} subtitle={t("appearance.subtitle")}>
      <Segmented
        wide
        label={t("appearance.title")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "application", label: t("appearance.tabs.application") },
          { value: "overlay", label: t("appearance.tabs.overlay") },
        ]}
      />

      {tab === "application" ? (
        <PresetGrid theme={appTheme} />
      ) : (
        <OverlaySection
          overlayTheme={overlayTheme}
          onOverlayThemeChange={onOverlayThemeChange}
          overlaySize={overlaySize}
          onOverlaySizeChange={onOverlaySizeChange}
        />
      )}
    </PageShell>
  );
}
