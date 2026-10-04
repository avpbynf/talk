/** The reasons a sync or a sign-in can fail, as the backend names them. */
export const GOOGLE_ERRORS = [
  "offline",
  "grant_revoked",
  "api_disabled",
  "quota",
  "drive_full",
  "remote_unreadable",
  "remote_devices_unreadable",
  "database",
  "sign_in_timeout",
  "sign_in_refused",
  "sign_in_failed",
  "sign_in_no_email",
  "other",
] as const;

export type GoogleErrorCode = (typeof GOOGLE_ERRORS)[number];

/** The codes whose wording says everything: the raw text would only repeat it. */
const WORDED_IN_FULL: readonly GoogleErrorCode[] = [
  "offline",
  "grant_revoked",
  "quota",
  "drive_full",
  "remote_unreadable",
  "remote_devices_unreadable",
  "sign_in_timeout",
  "sign_in_no_email",
];

function isCode(text: string): text is GoogleErrorCode {
  return (GOOGLE_ERRORS as readonly string[]).includes(text);
}

/**
 * The code behind whatever the backend sent. A status saved by an earlier
 * version holds Google's own text, and so does anything unexpected: both read
 * as `other`.
 */
export function googleErrorCode(raw: unknown): GoogleErrorCode {
  const text = String(raw);
  return isCode(text) ? text : "other";
}

export interface GoogleFailure {
  code: GoogleErrorCode;
  /** Google's or the system's own text, when it adds something to the wording. */
  detail: string | null;
}

/** What a command rejected with: `code: text`, or just a text of unknown origin. */
export function parseGoogleFailure(raw: unknown): GoogleFailure {
  const text = String(raw);
  const split = text.indexOf(": ");
  const head = split === -1 ? text : text.slice(0, split);
  if (isCode(head)) return failureOf(head, split === -1 ? "" : text.slice(split + 2));
  return failureOf("other", text);
}

/** The failure a sync left in the status: the code, and the text kept beside it. */
export function statusFailure(lastError: string | null, lastErrorDetail?: string | null): GoogleFailure | null {
  if (!lastError) return null;
  if (isCode(lastError)) return failureOf(lastError, lastErrorDetail ?? "");
  return failureOf("other", lastErrorDetail ?? lastError);
}

function failureOf(code: GoogleErrorCode, detail: string): GoogleFailure {
  const text = detail.trim();
  return { code, detail: text && !WORDED_IN_FULL.includes(code) ? text : null };
}
