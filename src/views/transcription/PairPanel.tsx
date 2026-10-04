import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, Loader2, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/SectionCard";
import type { PairError, PairGrant, PairRequest } from "@/lib/server";

interface PairPanelProps {
  url: string;
  /** What to call the server in the text, its name or its address */
  label: string;
  onPaired: (grant: PairGrant, url: string) => void;
  onClose: () => void;
}

type Step =
  | { kind: "requesting" }
  | { kind: "code"; requestId: string; expiresIn: number; error: PairError | null }
  | { kind: "confirming"; requestId: string; expiresIn: number }
  | { kind: "failed"; error: PairError };

const PAIR_ERRORS: PairError[] = ["not_supported", "busy", "wrong_code", "expired", "unreachable"];

function asPairError(e: unknown): PairError {
  return typeof e === "string" && PAIR_ERRORS.includes(e as PairError) ? (e as PairError) : "unreachable";
}

export function PairPanel({ url, label, onPaired, onClose }: PairPanelProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ kind: "requesting" });
  const [code, setCode] = useState("");
  const started = useRef(false);

  const start = async () => {
    setStep({ kind: "requesting" });
    setCode("");
    try {
      const request = await invoke<PairRequest>("pair_request", { url });
      setStep({
        kind: "code",
        requestId: request.request_id,
        expiresIn: request.expires_in,
        error: null,
      });
    } catch (e) {
      setStep({ kind: "failed", error: asPairError(e) });
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, []);

  const confirm = async () => {
    if (step.kind !== "code") return;
    const { requestId, expiresIn } = step;
    setStep({ kind: "confirming", requestId, expiresIn });
    try {
      const grant = await invoke<PairGrant>("pair_confirm", { url, requestId, code });
      onPaired(grant, url);
    } catch (e) {
      const error = asPairError(e);
      if (error === "wrong_code" || error === "unreachable") {
        setStep({ kind: "code", requestId, expiresIn, error });
      } else {
        setStep({ kind: "failed", error });
      }
    }
  };

  const minutes = step.kind === "code" || step.kind === "confirming" ? Math.round(step.expiresIn / 60) : 0;
  const complete = /^\d{6}$/.test(code);

  return (
    <SectionCard
      icon={KeyRound}
      title={
        <Trans
          i18nKey="transcription.pair.title"
          values={{ label }}
          components={{ label: <span /> }}
        />
      }
      description={t("transcription.pair.subtitle")}
      className="border-[var(--color-server)]/30"
      action={
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={t("common.close")}
          className="text-muted-foreground"
        >
          <X />
        </Button>
      }
    >
      {step.kind === "requesting" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("transcription.pair.requesting")}
        </p>
      )}

      {(step.kind === "code" || step.kind === "confirming") && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={code}
              disabled={step.kind === "confirming"}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && complete && void confirm()}
              placeholder="000000"
              aria-label={t("pairingBanner.codeLabel")}
              className="w-32 tabular-nums tracking-widest"
            />
            <Button onClick={() => void confirm()} disabled={!complete || step.kind === "confirming"}>
              {step.kind === "confirming" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.confirm")}
            </Button>
          </div>
          {step.kind === "code" && step.error && (
            <p role="alert" className="text-xs text-[var(--color-destructive)]">
              {t(`transcription.pair.errors.${step.error}`)}
            </p>
          )}
          {minutes > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("transcription.pair.validFor", { count: minutes })}
            </p>
          )}
        </div>
      )}

      {step.kind === "failed" && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-[var(--color-destructive)]">
            {t(`transcription.pair.errors.${step.error}`)}
          </p>
          {step.error !== "not_supported" && (
            <Button variant="outline" onClick={() => void start()}>
              {t("transcription.pair.startAgain")}
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
