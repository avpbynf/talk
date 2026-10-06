import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface SetupHeaderProps {
  total: number;
  /** The step on screen, counted from 1. */
  current: number;
}

export function SetupHeader({ total, current }: SetupHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex-none px-10 pt-[30px]">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-[image:var(--grad-fill)] text-on-accent shadow-[0_8px_22px_-10px_color-mix(in_oklch,var(--s1)_80%,transparent),inset_0_1px_0_rgb(255_255_255/0.22)]">
          <Sparkles aria-hidden="true" className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.02em]">Talk</h1>
          <p className="mt-px text-[13px] text-muted-foreground">{t("setup.subtitle")}</p>
        </div>
      </div>

      <div aria-hidden="true" className="mt-[22px] flex gap-1.5">
        {Array.from({ length: total }, (_, i) => {
          const here = i + 1 === current;
          return (
            <i
              key={i}
              className={cn(
                "relative h-1 flex-1 rounded-full bg-foreground/10",
                here && "shadow-[0_0_12px_-1px_color-mix(in_oklch,var(--s2)_75%,transparent)]",
              )}
            >
              <span
                className={cn(
                  "absolute inset-0 origin-left scale-x-0 rounded-full bg-[image:var(--grad-x)] opacity-55 transition-[transform,opacity] duration-[600ms,400ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                  i + 1 < current && "scale-x-100",
                  here && "scale-x-100 opacity-100",
                )}
              />
            </i>
          );
        })}
      </div>
    </div>
  );
}
