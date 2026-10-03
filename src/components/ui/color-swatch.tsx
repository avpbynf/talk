import { cn } from "@/lib/utils";

interface ColorSwatchProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Show the hex code beside the swatch. */
  showCode?: boolean;
  className?: string;
}

/** A round colour field, with its code beside it when asked. */
export function ColorSwatch({ value, onChange, label, showCode = true, className }: ColorSwatchProps) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2", className)}>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="swatch"
      />
      {showCode && <span className="w-16 font-mono text-xs uppercase text-muted-foreground">{value}</span>}
    </label>
  );
}
