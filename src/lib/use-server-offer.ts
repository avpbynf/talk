import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DiscoveredServer } from "@/lib/server";

/**
 * A server worth offering, at most one at a time.
 *
 * The backend decides: it answers with a server only in local mode and only
 * for one it has never offered, and remembers it as offered when it answers.
 * So asking again after a dismissal gets nothing for that server.
 */
export function useServerOffer(enabled: boolean) {
  const [offer, setOffer] = useState<DiscoveredServer | null>(null);
  const showing = useRef(false);
  const asking = useRef(false);

  useEffect(() => {
    showing.current = offer !== null;
  }, [offer]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unlisten: (() => void) | undefined;

    // The backend marks a server offered as it answers, so a second ask in
    // flight would burn a server that never reaches the screen. One at a time.
    const ask = () => {
      if (showing.current || asking.current) return;
      asking.current = true;
      invoke<DiscoveredServer | null>("next_server_offer")
        .then((server) => {
          if (active && server) {
            showing.current = true;
            setOffer(server);
          }
        })
        .catch(() => {})
        .finally(() => {
          asking.current = false;
        });
    };

    listen("servers-changed", ask).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    ask();

    return () => {
      active = false;
      unlisten?.();
    };
  }, [enabled]);

  const dismiss = useCallback(() => setOffer(null), []);

  return { offer, dismiss };
}
