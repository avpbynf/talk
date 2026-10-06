import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface StepPageProps {
  /** The model step, which holds a grid and so gives the column more room and less air. */
  wide?: boolean;
  /** Each child is a block of its own, and the page transition moves them one after the other. */
  children: ReactNode;
}

/** The column every step is laid out in, scrolling inside the window when it does not fit. */
export function StepPage({ wide, children }: StepPageProps) {
  return (
    <ScrollArea className="h-full">
      <div className={cn("px-10 pb-5", wide ? "pt-[26px]" : "pt-[34px]")}>
        <div
          data-page-blocks
          className={cn("mx-auto flex flex-col", wide ? "max-w-[680px] gap-3.5" : "max-w-[600px] gap-[18px]")}
        >
          {children}
        </div>
      </div>
    </ScrollArea>
  );
}
