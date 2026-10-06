import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "accent" | "ok" | "muted" | "warn" | "bad";
type Size = "sm" | "md" | "lg" | "xl";

const TONES: Record<Tone, string> = {
  accent: "bg-[var(--tint)] text-active",
  ok: "bg-[color-mix(in_oklch,var(--color-success)_16%,transparent)] text-success-text",
  muted: "bg-foreground/8 text-muted-foreground",
  warn: "bg-[color-mix(in_oklch,var(--color-warning)_16%,transparent)] text-warning",
  bad: "bg-[color-mix(in_oklch,var(--color-destructive)_16%,transparent)] text-destructive",
};

const SIZES: Record<Size, string> = {
  sm: "size-[34px] rounded-[10px] [&_svg]:size-[17px]",
  md: "size-10 rounded-[11px] [&_svg]:size-5",
  xl: "size-12 rounded-[13px] [&_svg]:size-6",
  lg: "size-[52px] rounded-[14px] [&_svg]:size-[26px]",
};

interface TileProps {
  icon: LucideIcon;
  tone?: Tone;
  size?: Size;
  spin?: boolean;
}

/** A rounded square holding an icon, tinted for what it says. */
export function Tile({ icon: Icon, tone = "accent", size = "md", spin }: TileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center transition-colors duration-[400ms]",
        TONES[tone],
        SIZES[size],
      )}
    >
      <Icon className={cn(spin && "animate-spin")} />
    </span>
  );
}
