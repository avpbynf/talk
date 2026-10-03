import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface RangeProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  className?: string;
}

/** A slider whose filled part is the accent gradient. */
export function Range({ value, min, max, step = 1, onChange, label, className }: RangeProps) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ "--v": `${fill}%` } as CSSProperties}
      className={cn("range w-[180px] max-w-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background", className)}
    />
  );
}
