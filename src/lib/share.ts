import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ShareState = "off" | "serving" | "port_busy" | "error";

/** What `share_get_status` answers. */
export interface ShareInfo {
  enabled: boolean;
  port: number;
  state: ShareState;
  address: string | null;
  message: string | null;
  announceError: string | null;
  model: string | null;
  pairingLocked: boolean;
}

/** A machine paired with this PC. */
export interface ShareDevice {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A machine waiting for its code to be read out to it. */
export interface PendingPairing {
  requestId: string;
  clientName: string;
  code: string;
  secondsLeft: number;
}

/** What the card says about the server, in one line. */
export function describeShare(info: ShareInfo): string {
  switch (info.state) {
    case "serving":
      return info.model ? "Serving" : "Waiting for a model";
    case "port_busy":
      return "Port already in use";
    case "error":
      return "Could not start";
    default:
      return "Off";
  }
}

/** The state of sharing and the machines paired with it, kept current by the backend. */
export function useShare(currentModel: string | null) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [devices, setDevices] = useState<ShareDevice[]>([]);

  const loadDevices = useCallback(() => {
    invoke<ShareDevice[]>("share_list_devices")
      .then((list) => Array.isArray(list) && setDevices(list))
      .catch(() => {});
  }, []);

  const loadStatus = useCallback(() => {
    invoke<ShareInfo>("share_get_status")
      .then((status) => status && setInfo(status))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    const stops: Array<() => void> = [];
    const watch = <T,>(event: string, handler: (payload: T) => void) => {
      listen<T>(event, (e) => active && handler(e.payload)).then((stop) => {
        if (active) stops.push(stop);
        else stop();
      });
    };

    watch<ShareInfo>("share-status-changed", setInfo);
    watch<null>("share-devices-changed", loadDevices);
    loadStatus();
    loadDevices();

    return () => {
      active = false;
      stops.forEach((stop) => stop());
    };
  }, [loadDevices, loadStatus]);

  // The model is part of what the card says, and it changes from other pages.
  useEffect(loadStatus, [currentModel, loadStatus]);

  const setEnabled = async (enabled: boolean) => {
    setInfo(await invoke<ShareInfo>("share_set_enabled", { enabled }));
  };

  const setPort = async (port: number) => {
    setInfo(await invoke<ShareInfo>("share_set_port", { port }));
  };

  const revoke = async (id: string) => {
    await invoke("share_revoke_device", { id });
    loadDevices();
  };

  return { info, devices, setEnabled, setPort, revoke };
}

/** The pairing requests waiting on this PC, with the codes to read out. */
export function usePendingPairings(): PendingPairing[] {
  const [pending, setPending] = useState<PendingPairing[]>([]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    listen<PendingPairing[]>("share-pairing-changed", (event) => {
      if (active) setPending(event.payload);
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });

    invoke<PendingPairing[]>("share_pending_pairings")
      .then((list) => active && Array.isArray(list) && setPending(list))
      .catch(() => {});

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return pending;
}
