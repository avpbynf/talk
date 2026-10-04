import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PageShellProps {
  /** On the outermost element. */
  className?: string;
  /** Laid over the whole page, such as a confirmation dialog. */
  overlay?: ReactNode;
  children: ReactNode;
}

/**
 * A page has no title: the sidebar already says where you are, so the content starts at the top.
 * The container the narrow layouts query is the whole scrolling area, as the page column itself
 * stops at 800px.
 */
export function PageShell({ className, overlay, children }: PageShellProps) {
  return (
    <div className={cn("relative h-full flex flex-col overflow-hidden", className)}>
      <ScrollArea className="flex-1 min-h-0">
        <div className="@container">
          <div
            data-page-blocks
            className="mx-auto flex w-full max-w-[800px] flex-col gap-4 px-7 pb-8 pt-[18px] @max-[440px]:px-4"
          >
            {children}
          </div>
        </div>
      </ScrollArea>
      {overlay}
    </div>
  );
}
