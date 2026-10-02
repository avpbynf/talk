import { useEffect, useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import type { PendingPairing } from "@/lib/share";

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return now;
}

function formatLeft(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `valid ${minutes}:${rest}`;
}

/**
 * A strip under the titlebar for each machine asking to pair with this PC.
 * The code lives here and nowhere else: not in a log, not in the answer the
 * machine gets, so whoever is at this screen is the one who can hand it over.
 * A request leaves the strip when its two minutes are up.
 */
export function PairingBanner({ pending }: { pending: PendingPairing[] }) {
  // The backend states the time left when the list arrives, and the countdown
  // runs from there
  const receivedAt = useMemo(() => Date.now(), [pending]);
  const now = useNow();
  const elapsed = Math.floor((now - receivedAt) / 1000);

  const live = pending
    .map((request) => ({ request, left: request.secondsLeft - elapsed }))
    .filter(({ left }) => left > 0);
  if (live.length === 0) return null;

  return (
    <div className="shrink-0 space-y-2 border-b border-border-subtle bg-surface-raised px-4 py-2.5">
      {live.map(({ request, left }) => (
        <div key={request.requestId} className="flex items-center gap-3">
          <KeyRound className="h-4 w-4 shrink-0 text-[var(--color-server)]" />
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="font-medium">{request.clientName} wants to use this PC</span>
            <span className="ml-2 text-muted-foreground">code</span>
            <span className="ml-2 font-mono text-base font-semibold tracking-widest" aria-label="Pairing code">
              {request.code}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">{formatLeft(left)}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
