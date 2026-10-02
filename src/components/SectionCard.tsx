import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "active" | "server" | "warning";

// Spelled out in full: only class names written in full reach the stylesheet.
const ICON: Record<Accent, string> = {
  active: "text-[var(--color-active)]",
  server: "text-[var(--color-server)]",
  warning: "text-[var(--color-warning)]",
};

interface SectionCardProps {
  icon: LucideIcon;
  title: ReactNode;
  /** Makes the whole title, icon included, fold the card body shut and open. */
  fold?: { open: boolean; onToggle: () => void };
  /** Under the header, in the muted body size. */
  description?: ReactNode;
  /** Sits opposite the title: a switch, a toggle or a button. */
  action?: ReactNode;
  /** Tints the icon with the colour of the area the card belongs to. */
  accent?: Accent;
  className?: string;
  children?: ReactNode;
}

export function SectionCard({
  icon: Icon,
  title,
  fold,
  description,
  action,
  accent,
  className,
  children,
}: SectionCardProps) {
  const Title = fold ? "button" : "div";

  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-5 rounded-xl border border-border-card bg-surface-raised",
        className
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-3">
          <Title
            {...(fold && { onClick: fold.onToggle, "aria-expanded": fold.open })}
            className={cn(
              "flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide",
              fold && "group"
            )}
          >
            <Icon className={cn("h-4 w-4", accent && ICON[accent])} />
            {title}
            {fold && (
              <ChevronRight
                size={14}
                className={cn(
                  "text-muted-foreground/60 transition-transform duration-200 group-hover:text-foreground",
                  fold.open && "rotate-90"
                )}
              />
            )}
          </Title>
          {action}
        </div>
        {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
