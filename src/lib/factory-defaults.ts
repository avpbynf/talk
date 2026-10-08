/** What the settings start with, as `AppSettings::default()` has them on the Rust side. */
export const SYSTEM_DEFAULTS = {
  autostart_enabled: false,
  start_minimized: false,
  duck_audio_on_record: false,
  duck_volume_percent: 20,
  preserve_clipboard: true,
};

export const SOUND_DEFAULTS = {
  start_sound: "beep",
  stop_sound: "beep",
};

export const SERVER_DEFAULTS = {
  server_fallback: true,
};

/** The language and the audio devices follow the system when nothing is chosen. */
export const FOLLOWS_SYSTEM = null;

/** What puts a setting back to its factory value through the setter its control uses, or nothing while it is there already. */
export function resetTo<T>(value: T, factory: T, change: (value: T) => void): (() => void) | undefined {
  if (JSON.stringify(value) === JSON.stringify(factory)) return undefined;
  return () => change(factory);
}
