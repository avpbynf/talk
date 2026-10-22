import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import { isMac } from "@/lib/platform";
import { reportFailure, reportSuccess } from "@/lib/save-setting";

/** What the switch asks for and what the cable is doing about it. */
export interface MeetingMode {
  enabled: boolean;
  /** The microphone is reaching the cable right now. */
  routing: boolean;
  microphone: string | null;
  /** Why it is not, in the backend's words. */
  failure: string | null;
}

/** The backend emits this, without a payload, each time the answer to `readMeetingMode` moved. */
export const MEETING_MODE_CHANGED = "meeting-mode-changed";

export const readMeetingMode = () => invoke<MeetingMode>("get_meeting_mode");

/**
 * The cable is VB-Cable on Windows and BlackHole on a Mac, so the text that names it takes this
 * as its i18next context: on a Mac a key reads its `_mac` variant, and on Windows the plain one.
 */
export const CABLE_CONTEXT = isMac ? "mac" : undefined;

/** Meeting mode is asked for and nothing reaches the cable: a meeting listening to it hears silence. */
export function isSilent(mode: MeetingMode): boolean {
  return mode.enabled && !mode.routing;
}

/**
 * Says at the foot of the window that meeting mode is on and silent, at start-up and when the
 * route fails later, whatever page is open. Said once, until the microphone reaches the cable again,
 * and only to a window somebody is looking at: a notice goes on its own, so one shown while Talk
 * sits in the tray would be spent unseen. The window coming forward asks again.
 */
export function useMeetingModeWatch(): void {
  useEffect(() => {
    const check = () => {
      readMeetingMode()
        .then((mode) => {
          if (!isSilent(mode)) reportSuccess("meeting_route");
          else if (document.hasFocus()) reportFailure("meeting_route", i18n.t("preferences.meeting.silent", { context: CABLE_CONTEXT }));
        })
        .catch((error) => console.error("Failed to read meeting mode:", error));
    };
    check();
    const listener = listen(MEETING_MODE_CHANGED, check);
    window.addEventListener("focus", check);
    return () => {
      listener.then((unlisten) => unlisten());
      window.removeEventListener("focus", check);
    };
  }, []);
}
