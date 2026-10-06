import { cn } from "@/lib/utils";

interface StepTitleProps {
  title: string;
  subtitle: string;
  /** Tighter, for the step that has a lot to show under it. */
  compact?: boolean;
}

export function StepTitle({ title, subtitle, compact }: StepTitleProps) {
  return (
    <div className={cn("text-center", !compact && "mb-2")}>
      <h2
        className={cn(
          "text-balance font-semibold tracking-[-0.03em]",
          compact ? "mb-1 text-2xl" : "mb-2 text-[28px]",
        )}
      >
        {title}
      </h2>
      <p className="text-[15px] leading-[1.5] text-muted-foreground">{subtitle}</p>
    </div>
  );
}
