import { Blobatar } from "@blobatar/react";
import { sleepy, thinking } from "blobatar/expression";
import "blobatar/motion.css";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { useGoogleAccount } from "@/lib/use-google-account";
import { answerGoogleInvite } from "@/lib/use-google-invite";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { WIZARD_BUTTON } from "./controls";
import { Note } from "./Note";
import { StepPage } from "./StepPage";
import { StepTitle } from "./StepTitle";

interface GoogleStepProps {
  google: ReturnType<typeof useGoogleAccount>;
  onSkip: () => void;
}

export function GoogleStep({ google, onSkip }: GoogleStepProps) {
  const { t } = useTranslation();
  const email = google.status?.email ?? null;
  const waiting = google.busy === "signIn";

  return (
    <StepPage>
      <StepTitle title={t("setup.google.title")} subtitle={t("setup.google.subtitle")} />

      <Card className="items-center gap-4 px-7 pb-[26px] pt-[30px] text-center">
        <div className="relative grid size-[92px] place-items-center">
          <Blobatar
            name={email ?? "talk"}
            size={78}
            animate="always"
            expression={email ? undefined : waiting ? thinking : sleepy}
            aria-hidden="true"
            className={cn(
              "avatar-live drop-shadow-[0_8px_14px_rgb(0_0_0/0.4)] transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
              waiting && "scale-[0.88]",
            )}
          />
          <svg
            viewBox="0 0 100 100"
            aria-hidden="true"
            className={cn(
              "absolute inset-0 size-full animate-spin opacity-0 transition-opacity duration-300 [animation-duration:1.1s]",
              waiting && "opacity-100",
            )}
          >
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="70 220"
              className="stroke-[var(--s2)]"
            />
          </svg>
        </div>

        <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{t("account.title")}</h3>
        <p className="max-w-[44ch] text-sm leading-[1.55] text-muted-foreground">{t("googleInvite.text")}</p>

        {email ? (
          <span className="inline-flex max-w-full items-center gap-2 text-sm font-medium">
            <i aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success" />
            <span className="truncate">{t("account.signedInAs", { email })}</span>
          </span>
        ) : (
          <>
            {google.failure && (
              <Note tone="bad" alert className="w-full text-start">
                {google.failure}
              </Note>
            )}
            <div className="mt-1.5 flex w-full gap-2.5">
              <Button
                className={cn(WIZARD_BUTTON, "flex-1")}
                disabled={google.busy !== null}
                onClick={async () => {
                  await answerGoogleInvite();
                  await google.run("signIn");
                }}
              >
                {waiting ? (
                  <>
                    <Loader2 className="animate-spin" />
                    {t("account.signingIn")}
                  </>
                ) : google.failure ? (
                  <>
                    <RefreshCw />
                    {t("common.retry")}
                  </>
                ) : (
                  t("account.signIn")
                )}
              </Button>
              {waiting && (
                <Button variant="outline" className={WIZARD_BUTTON} onClick={google.cancelSignIn}>
                  {t("account.cancelSignIn")}
                </Button>
              )}
              <Button variant="outline" className={WIZARD_BUTTON} disabled={google.busy !== null} onClick={onSkip}>
                {t("setup.google.skip")}
              </Button>
            </div>
          </>
        )}
      </Card>
    </StepPage>
  );
}
