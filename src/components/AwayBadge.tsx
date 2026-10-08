import { useTranslation } from "react-i18next";

/** A small figure for the settings inside a closed section that are away from their defaults. */
export function AwayBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <span className="inline-block h-4 min-w-4 rounded-full bg-[image:var(--grad-fill)] px-[5px] text-center text-[10px] font-medium leading-4 text-on-accent">
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{t("common.awayCount", { count })}</span>
    </span>
  );
}
