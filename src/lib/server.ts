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

/** A Talk-Server announcing itself on the local network. */
export interface DiscoveredServer {
  id: string;
  name: string;
  url: string;
  version: string | null;
  model: string | null;
}
