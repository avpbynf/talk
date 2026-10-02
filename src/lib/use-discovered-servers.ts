import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DiscoveredServer } from "@/lib/server";

/** The servers announcing themselves on the network, kept current by the backend. */
export function useDiscoveredServers(): DiscoveredServer[] {
  const [servers, setServers] = useState<DiscoveredServer[]>([]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    listen<DiscoveredServer[]>("servers-changed", (event) => {
      if (active) setServers(event.payload);
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });

    invoke<DiscoveredServer[]>("list_discovered_servers")
      .then((list) => {
        if (active && Array.isArray(list)) setServers(list);
      })
      .catch(() => {});

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return servers;
}
