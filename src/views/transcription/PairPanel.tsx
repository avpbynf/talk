import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const MESSAGES: Record<PairError, string> = {
  not_supported: "This server does not offer pairing. Paste its token above instead.",
  busy: "The server already has several pairing requests waiting. Try again in a minute.",
  wrong_code: "That code is not right. Check it on the server and try again.",
  expired: "This code has expired, or too many wrong codes were tried. Start again to get a new one.",
  unreachable: "Could not reach the server.",
};

function asPairError(e: unknown): PairError {
  return typeof e === "string" && e in MESSAGES ? (e as PairError) : "unreachable";
}

export function PairPanel({ url, label, onPaired, onClose }: PairPanelProps) {
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
    <div className="p-5 rounded-xl border border-[var(--color-server)]/30 bg-surface-raised space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-[var(--color-server)]/15 flex items-center justify-center">
            <KeyRound className="h-4 w-4 text-server" />
          </div>
          <div>
            <h3 className="font-medium text-sm">Pair with {label}</h3>
            <p className="text-xs text-muted-foreground">
              The server shows a 6 digit code in its log and on its admin page.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer p-1 rounded-md text-muted-foreground hover:bg-surface-active"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {step.kind === "requesting" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Asking the server for a code...
        </p>
      )}

      {(step.kind === "code" || step.kind === "confirming") && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={code}
              disabled={step.kind === "confirming"}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && complete && void confirm()}
              placeholder="000000"
              aria-label="Pairing code"
              className="w-32 px-3 py-2 text-sm rounded-lg border border-border-card bg-surface-inset font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[var(--color-server)]/30 focus:border-[var(--color-server)]"
            />
            <Button onClick={() => void confirm()} disabled={!complete || step.kind === "confirming"}>
              {step.kind === "confirming" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
            </Button>
          </div>
          {step.kind === "code" && step.error && (
            <p role="alert" className="text-xs text-[var(--color-destructive)]">
              {MESSAGES[step.error]}
            </p>
          )}
          {minutes > 0 && (
            <p className="text-xs text-muted-foreground">
              The code is valid for about {minutes} {minutes === 1 ? "minute" : "minutes"}.
            </p>
          )}
        </div>
      )}

      {step.kind === "failed" && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-[var(--color-destructive)]">
            {MESSAGES[step.error]}
          </p>
          {step.error !== "not_supported" && (
            <Button variant="outline" onClick={() => void start()}>
              Start again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
