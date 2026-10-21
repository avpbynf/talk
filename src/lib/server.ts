export type ServerStatus = "unknown" | "checking" | "online" | "unauthorized" | "offline";

/** What `test_server_connection` answers. */
export type ServerCheck = "ok" | "unauthorized" | "unreachable";

export function statusFromCheck(check: ServerCheck): ServerStatus {
  switch (check) {
    case "ok":
      return "online";
    case "unauthorized":
      return "unauthorized";
    default:
      return "offline";
  }
}

/**
 * The server a URL names, the way the backend reads it (`normalize_base_url`): the full
 * transcription endpoint and a trailing `/v1` name the same server as the bare address.
 */
export function normalizeServerUrl(url: string): string {
  let base = url.trim().replace(/\/+$/, "");
  for (const suffix of ["/audio/transcriptions", "/v1"]) {
    if (base.toLowerCase().endsWith(suffix)) base = base.slice(0, -suffix.length).replace(/\/+$/, "");
  }
  return base.toLowerCase();
}

/** A Talk-Server announcing itself on the local network. */
export interface DiscoveredServer {
  id: string;
  name: string;
  url: string;
  version: string | null;
  model: string | null;
  pairing: boolean;
}

/** Why `pair_request` or `pair_confirm` refused. */
export type PairError = "not_supported" | "busy" | "wrong_code" | "expired" | "unreachable";

export interface PairRequest {
  request_id: string;
  expires_in: number;
}

export interface PairGrant {
  token: string;
  name: string;
}
