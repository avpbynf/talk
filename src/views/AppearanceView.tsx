import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WindowButtonsSide } from "@/App";
import type { AppThemeController } from "@/lib/use-app-theme";
import { PageShell } from "@/components/PageShell";
import { Segmented } from "@/components/ui/segmented";
import PresetGrid from "./appearance/PresetGrid";
import GradientEditor from "./appearance/GradientEditor";
import AtmosphereCard from "./appearance/AtmosphereCard";
import BaseColorsCard from "./appearance/BaseColorsCard";
import ShapeCard from "./appearance/ShapeCard";

// Its three styles, the engine and the avatar library are the overlay's: no other page pays for them.
const OverlayTab = lazy(() => import("./appearance/OverlayTab"));

interface AppearanceViewProps {
  appTheme: AppThemeController;
  windowButtons: WindowButtonsSide;
  onWindowButtonsChange: (side: WindowButtonsSide) => void;
}

type Tab = "application" | "overlay";

export default function AppearanceView({ appTheme, windowButtons, onWindowButtonsChange }: AppearanceViewProps) {
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
        <>
          <PresetGrid theme={appTheme} />
          <GradientEditor theme={appTheme} />
          <AtmosphereCard theme={appTheme} />
          <BaseColorsCard theme={appTheme} />
          <ShapeCard
            theme={appTheme}
            windowButtons={windowButtons}
            onWindowButtonsChange={onWindowButtonsChange}
          />
        </>
      ) : (
        <Suspense fallback={null}>
          <OverlayTab appTheme={appTheme} />
        </Suspense>
      )}
    </PageShell>
  );
}
