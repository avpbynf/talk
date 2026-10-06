import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { WIZARD_BUTTON } from "./controls";

interface SetupFooterProps {
  current: number;
  total: number;
  isLast: boolean;
  canProceed: boolean;
  isCompleting: boolean;
  /** The last attempt to finish failed, so the button offers another. */
  failed: boolean;
  onBack: () => void;
  onNext: () => void;
  onFinish: () => void;
}

export function SetupFooter({
  current,
  total,
  isLast,
  canProceed,
  isCompleting,
  failed,
  onBack,
  onNext,
  onFinish,
}: SetupFooterProps) {
  const { t } = useTranslation();
  return (
    <div className="grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-4 border-t border-border-subtle bg-surface-inset px-10 py-4">
      <div>
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={current === 1 || isCompleting}
          className={`${WIZARD_BUTTON} pl-2.5`}
        >
          <ChevronLeft />
          {t("setup.nav.back")}
        </Button>
      </div>

      <span className="text-[13px] text-muted-foreground">{t("setup.nav.step", { current, total })}</span>

      <div className="justify-self-end">
        {isLast ? (
          <Button onClick={onFinish} disabled={isCompleting} className={`${WIZARD_BUTTON} min-w-[132px]`}>
            {isCompleting ? (
              <>
                <Loader2 className="animate-spin" />
                {t("setup.nav.settingUp")}
              </>
            ) : failed ? (
              <>
                <RefreshCw />
                {t("common.retry")}
              </>
            ) : (
              <>
                <Rocket />
                {t("setup.nav.getStarted")}
              </>
            )}
          </Button>
        ) : (
          <Button onClick={onNext} disabled={!canProceed} className={`${WIZARD_BUTTON} min-w-[132px]`}>
            {t("setup.nav.next")}
            <ChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
}
