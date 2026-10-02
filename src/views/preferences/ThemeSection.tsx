import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type AppThemeId,
  APP_THEME_IDS,
  getAppThemeLabel,
  getAppThemeCategory,
  getAppThemePreview,
} from "@/lib/app-themes";
import { SectionCard } from "@/components/SectionCard";
import { cn } from "@/lib/utils";

interface ThemeSectionProps {
  appTheme: AppThemeId;
  onAppThemeChange: (theme: AppThemeId) => void;
}

function ThemeCard({
  id,
  isActive,
  onSelect,
}: {
  id: AppThemeId;
  isActive: boolean;
  onSelect: (id: AppThemeId) => void;
}) {
  const [bg, accent, surface] = getAppThemePreview(id);
  const label = getAppThemeLabel(id);

  return (
    <button
      onClick={() => onSelect(id)}
      className={cn(
        "cursor-pointer flex flex-col items-center gap-2 p-3 rounded-lg border transition-all duration-200",
        isActive
          ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
          : "border-border-card bg-surface-deep hover:border-border-hover hover:bg-surface-raised",
      )}
    >
      {/* Mini app preview */}
      <div
        className="w-full aspect-[16/10] rounded-md border border-black/10 overflow-hidden flex"
        style={{ background: bg }}
      >
        {/* Fake sidebar */}
        <div className="w-1/5 h-full" style={{ background: surface }} />
        {/* Fake content area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-1 px-1">
          <div
            className="w-3/4 h-1 rounded-full"
            style={{ background: accent }}
          />
          <div
            className="w-1/2 h-1 rounded-full opacity-40"
            style={{ background: accent }}
          />
        </div>
      </div>
      <span
        className={cn(
          "text-xs font-medium",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

export default function ThemeSection({
  appTheme,
  onAppThemeChange,
}: ThemeSectionProps) {
  const { t } = useTranslation();
  const darkThemes = APP_THEME_IDS.filter(
    (id) => getAppThemeCategory(id) === "dark",
  );
  const lightThemes = APP_THEME_IDS.filter(
    (id) => getAppThemeCategory(id) === "light",
  );

  return (
    <SectionCard
      icon={Palette}
      title={t("appearance.theme.title")}
      description={t("appearance.theme.description")}
    >
      {/* Dark themes */}
      <div className="space-y-2 pt-4 border-t border-border-subtle">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("appearance.theme.dark")}
        </span>
        <div className="grid grid-cols-3 gap-3">
          {darkThemes.map((id) => (
            <ThemeCard
              key={id}
              id={id}
              isActive={appTheme === id}
              onSelect={onAppThemeChange}
            />
          ))}
        </div>
      </div>

      {/* Light themes */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("appearance.theme.light")}
        </span>
        <div className="grid grid-cols-3 gap-3">
          {lightThemes.map((id) => (
            <ThemeCard
              key={id}
              id={id}
              isActive={appTheme === id}
              onSelect={onAppThemeChange}
            />
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
