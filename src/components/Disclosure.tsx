import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AwayBadge } from "@/components/AwayBadge";
import { cn } from "@/lib/utils";

interface DisclosureProps {
  /** How many of the settings inside are away from their defaults, shown while the section is shut. */
  away?: number;
  /** Rows, each one a section of the card it sits in. */
  children: ReactNode;
}

/**
 * The "Advanced" row at the foot of a card: shut, it is one quiet line, and it opens in place.
 * It renders into the card's own list, so what it reveals takes the card's rows and their rules.
 */
export function Disclosure({ away = 0, children }: DisclosureProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group flex w-full cursor-pointer items-center gap-2 py-[11px]! text-start text-[13px] text-muted-foreground outline-none transition-colors last:rounded-b-[calc(var(--radius)+3px)] hover:bg-[var(--tint-2)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-active)]"
      >
        <ChevronRight aria-hidden="true" className={cn("h-3.5 w-3.5 transition-transform duration-300", open && "rotate-90")} />
        {t("common.advanced")}
        {away > 0 && !open && <AwayBadge count={away} />}
      </button>
      {open && children}
    </>
  );
}
