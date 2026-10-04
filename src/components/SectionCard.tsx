import { Children, type ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "active" | "server" | "warning";

// Spelled out in full: only class names written in full reach the stylesheet.
const TILE: Record<Accent, string> = {
  active: "bg-[var(--tint)] text-[var(--color-active)]",
  server: "bg-[color-mix(in_oklch,var(--color-server)_16%,transparent)] text-[var(--color-server)]",
  warning: "bg-[color-mix(in_oklch,var(--color-warning)_16%,transparent)] text-[var(--color-warning)]",
};

interface SectionCardProps {
  icon: LucideIcon;
  title: ReactNode;
  /** A figure that sits beside the title, in the muted style. */
  count?: ReactNode;
  /** Makes the whole title, icon included, fold the card body shut and open. */
  fold?: { open: boolean; onToggle: () => void };
  /** The first section under the header, in the muted body size. */
  description?: ReactNode;
  /** Sits opposite the title: a switch, a toggle or a button. */
  action?: ReactNode;
  /** Tints the icon with the colour of the area the card belongs to. */
  accent?: Accent;
  className?: string;
  /** Each child is a section of its own, closed above by a hairline. */
  children?: ReactNode;
}

export function SectionCard({
  icon: Icon,
  title,
  count,
  fold,
  description,
  action,
  accent = "active",
  className,
  children,
}: SectionCardProps) {
  const Title = fold ? "button" : "div";
  const hasBody = Boolean(description) || Children.toArray(children).length > 0;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-[calc(var(--radius)+4px)] border border-border-card bg-surface-raised shadow-[var(--shadow)]",
        className,
      )}
    >
      <div className="flex min-h-[50px] flex-wrap items-center gap-x-2.5 gap-y-2 px-[18px] py-[14px]">
        <Title
          {...(fold && { onClick: fold.onToggle, "aria-expanded": fold.open })}
          className={cn(
            "flex min-w-0 items-center gap-2.5 text-start text-sm font-semibold",
            fold && "group outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-active)]",
          )}
        >
          <span
            className={cn(
              "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[calc(var(--radius)*0.7)]",
              TILE[accent],
            )}
          >
            <Icon className="h-[15px] w-[15px]" />
          </span>
          {title}
          {count !== undefined && (
            <span className="text-[13px] font-medium tabular-nums text-muted-foreground">{count}</span>
          )}
          {fold && (
            <ChevronRight
              size={14}
              className={cn(
                "text-muted-foreground/60 transition-transform duration-200 group-hover:text-foreground",
                fold.open && "rotate-90",
              )}
            />
          )}
        </Title>
        {action && <span className="ml-auto flex items-center gap-2 font-normal">{action}</span>}
      </div>
      {hasBody && (
        <div className="divide-y divide-border-subtle border-t border-border-subtle [&>*]:px-[18px] [&>*]:py-[14px]">
          {description && <p className="max-w-[64ch] text-[13px] leading-[1.55] text-muted-foreground">{description}</p>}
          {children}
        </div>
      )}
    </div>
  );
}
