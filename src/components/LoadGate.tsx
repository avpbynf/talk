import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { retryReads, useReadFailed, type ReadGroup } from "@/lib/read-state";

interface LoadGateProps {
  /** The reads this content depends on. */
  groups: ReadGroup[];
  /** What Retry runs, when the content reads for itself; the reads of start-up otherwise. */
  onRetry?: () => void;
  /** A card among others, not a whole page: the reason sits on top of it, in the flow. */
  inline?: boolean;
  /** The first read has not come back: the controls are locked, without a reason to give yet. */
  pending?: boolean;
  children: ReactNode;
}

/**
 * Locks what depends on a read that failed. The controls would show a default, and the next
 * edit would save that default over what is stored, so they are disabled until a read succeeds,
 * with the reason and a Retry beside them.
 */
export function LoadGate({ groups, onRetry = retryReads, inline = false, pending = false, children }: LoadGateProps) {
  const { t } = useTranslation();
  const failed = useReadFailed(...groups);
  // The same element before and after the first read: swapping it for its bare children would
  // mount the content a second time, and a card that was arriving with its page would be replaced
  // by one that is simply there. It is not dimmed while it waits either, since the wait is the
  // length of the arrival and a card brightening as it lands reads as a flash.
  if (!failed && (inline || pending)) {
    return (
      <fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">
        {children}
      </fieldset>
    );
  }
  if (!failed) return <>{children}</>;

  const notice = (
    <div
      role="alert"
      className={
        inline
          ? "flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]"
          : "mx-auto flex w-full max-w-[800px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-7 pt-[18px] text-[13px] @max-[440px]:px-4"
      }
    >
      <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 basis-56 text-muted-foreground">{t("common.locked")}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );

  return (
    <div className={inline ? "flex flex-col gap-3" : "flex h-full min-h-0 flex-col"}>
      {notice}
      <fieldset disabled className={inline ? "m-0 min-w-0 border-0 p-0 opacity-60" : "m-0 min-h-0 min-w-0 flex-1 border-0 p-0 opacity-60"}>
        {children}
      </fieldset>
    </div>
  );
}
