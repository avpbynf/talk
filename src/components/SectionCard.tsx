import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "active" | "server" | "warning";

// Spelled out in full: only class names written in full reach the stylesheet.
const TILE: Record<Accent, { tile: string; icon: string }> = {
  active: { tile: "bg-[var(--color-active)]/15", icon: "text-[var(--color-active)]" },
  server: { tile: "bg-[var(--color-server)]/15", icon: "text-server" },
  warning: { tile: "bg-[var(--color-warning)]/10", icon: "text-warning" },
};

interface SectionCardProps {
  variant?: "label" | "tile";
  icon?: LucideIcon;
  title: ReactNode;
  /** Under the title in the tile shape, under the header in the label one. */
  description?: ReactNode;
  /** Sits opposite the title. */
  action?: ReactNode;
  alignAction?: "start";
  accent?: Accent;
  className?: string;
  children?: ReactNode;
}

function Header({
  variant,
  icon: Icon,
  title,
  description,
  action,
  alignAction,
  accent = "active",
}: Omit<SectionCardProps, "className" | "children">) {
  if (variant === "tile" && Icon) {
    return (
      <div className={cn("flex justify-between gap-3", alignAction === "start" ? "items-start" : "items-center")}>
        <div className="flex items-center gap-2">
          <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", TILE[accent].tile)}>
            <Icon className={cn("h-4 w-4", TILE[accent].icon)} />
          </div>
          <div>
            <h3 className="font-medium text-sm">{title}</h3>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {Icon && <Icon className="h-4 w-4" />}
          {title}
        </div>
        {action}
      </div>
      {description && <p className="mt-3 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function SectionCard({ className, children, variant = "label", ...header }: SectionCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-5 rounded-xl border border-border-card bg-surface-raised",
        className
      )}
    >
      <Header variant={variant} {...header} />
      {children}
    </div>
  );
}
