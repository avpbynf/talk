import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type DeviceScope = "all" | "this";

const ORDER: DeviceScope[] = ["all", "this"];

interface DeviceScopeFilterProps {
  value: DeviceScope;
  onChange: (scope: DeviceScope) => void;
}

export function DeviceScopeFilter({ value, onChange }: DeviceScopeFilterProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("dashboard.scope.label")}
      className="flex p-[3px] rounded-lg bg-surface-inset border border-border-card"
    >
      {ORDER.map((id) => {
        const isActive = value === id;

        return (
          <button
            key={id}
            aria-pressed={isActive}
            onClick={() => onChange(id)}
            className={cn(
              "px-3 py-1 rounded-md text-xs transition-colors duration-150",
              isActive
                ? "bg-surface-active text-[var(--color-active)] font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`dashboard.scope.${id}`)}
          </button>
        );
      })}
    </div>
  );
}
