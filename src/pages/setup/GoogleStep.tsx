import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/SectionCard";
import type { useGoogleAccount } from "@/lib/use-google-account";
import { answerGoogleInvite } from "@/lib/use-google-invite";
import { StepTitle } from "./StepTitle";

interface GoogleStepProps {
  google: ReturnType<typeof useGoogleAccount>;
  onSkip: () => void;
}

export function GoogleStep({ google, onSkip }: GoogleStepProps) {
  const { t } = useTranslation();
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <StepTitle title={t("setup.google.title")} subtitle={t("setup.google.subtitle")} />

      <SectionCard icon={UserRound} title={t("account.title")} description={t("googleInvite.text")}>
        {google.status?.email ? (
          <p className="text-sm font-medium truncate">{t("account.signedInAs", { email: google.status.email })}</p>
        ) : (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={google.busy !== null}
              onClick={async () => {
                await answerGoogleInvite();
                await google.run("signIn");
              }}
            >
              {google.busy === "signIn" ? t("account.signingIn") : t("account.signIn")}
            </Button>
            {google.busy === "signIn" && (
              <Button variant="outline" className="flex-1" onClick={google.cancelSignIn}>
                {t("account.cancelSignIn")}
              </Button>
            )}
            <Button className="flex-1" disabled={google.busy !== null} onClick={onSkip}>
              {t("setup.google.skip")}
            </Button>
          </div>
        )}
        {google.failure && <p className="text-sm text-destructive">{google.failure}</p>}
      </SectionCard>
    </div>
  );
}
