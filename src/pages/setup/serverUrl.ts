/** Whether a server address is one the app can talk to: a web address, not a bare word. */
export function isServerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
