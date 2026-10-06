import { invoke } from "@tauri-apps/api/core";
import type { ReadGroup } from "@/lib/read-state";
import { saveSetting } from "@/lib/save-setting";

/** Which start-up read each setting of the shell comes from: while it has failed, the setting is not saved. */
const GROUP: Record<string, ReadGroup> = {
  recording_mode: "hotkeys",
  transcription_mode: "settings",
  server_url: "settings",
  server_fallback: "settings",
  server_timeout: "settings",
  server_token: "token",
  server_model: "serverModel",
  autostart_enabled: "settings",
  start_minimized: "settings",
  duck_audio_on_record: "settings",
  duck_volume_percent: "settings",
  preserve_clipboard: "settings",
  sound_feedback: "sounds",
  start_sound: "sounds",
  stop_sound: "sounds",
  companion_shortcuts: "companions",
  history_limit: "historyLimit",
};

/**
 * A handler for one setting of the shell: the control shows the value at once and
 * `command` stores it under the argument name `arg`. The key is the setting's own
 * name, which is also what the start-up read confirms.
 */
export function setting<T>(key: keyof typeof GROUP & string, apply: (value: T) => void, command: string, arg: string) {
  return (value: T) =>
    saveSetting({ key, group: GROUP[key], next: value, apply, save: (v) => invoke(command, { [arg]: v }) });
}
