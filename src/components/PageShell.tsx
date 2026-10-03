import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PageShellProps {
  title?: string;
  /** A string is set in the muted style; anything else is placed as it comes. */
  subtitle?: ReactNode;
  /** Sits opposite the title. */
  action?: ReactNode;
  /** The rule under the title block. */
  separator?: boolean;
  /** The dashboard's column, wider than the settings pages. */
  wide?: boolean;
  /** On the outermost element. */
  className?: string;
  /** Laid over the whole page, such as a confirmation dialog. */
  overlay?: ReactNode;
  children: ReactNode;
}

export function PageSeparator() {
  return <div className="h-px bg-border-subtle" />;
}

function PageHeader({
  title,
  subtitle,
  action,
}: Pick<PageShellProps, "title" | "subtitle" | "action">) {
  return (
    <div className={cn(action && "flex items-center justify-between")}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <div className="mt-0.5">
            {typeof subtitle === "string" ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : (
              subtitle
            )}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

export function PageShell({
  title,
  subtitle,
  action,
  separator = true,
  wide = false,
  className,
  overlay,
  children,
}: PageShellProps) {
  const header = title && (
    <>
      <PageHeader title={title} subtitle={subtitle} action={action} />
      {separator && <PageSeparator />}
    </>
  );

  return (
    <div className={cn("relative h-full flex flex-col overflow-hidden", className)}>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          <div data-page-blocks className={cn("mx-auto space-y-6", wide ? "max-w-5xl" : "max-w-2xl")}>
            {header}
            {children}
          </div>
        </div>
      </ScrollArea>
      {overlay}
    </div>
  );
}
