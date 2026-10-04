import { useTranslation } from "react-i18next";
import { Segmented } from "@/components/ui/segmented";

export type DeviceScope = "all" | "this";

const ORDER: DeviceScope[] = ["all", "this"];

interface DeviceScopeFilterProps {
  value: DeviceScope;
  onChange: (scope: DeviceScope) => void;
}

export function DeviceScopeFilter({ value, onChange }: DeviceScopeFilterProps) {
  const { t } = useTranslation();
  return (
    <Segmented
      wide="narrow"
      label={t("dashboard.scope.label")}
      value={value}
      onChange={onChange}
      options={ORDER.map((id) => ({ value: id, label: t(`dashboard.scope.${id}`) }))}
      className="@max-[700px]:flex-1"
    />
  );
}
