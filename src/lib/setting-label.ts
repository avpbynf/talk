import { createContext, useContext } from "react";

/**
 * The id of the label of the setting row a control sits in. A switch or a select
 * has no text of its own, so it takes its name from the row unless it was given one.
 */
export const SettingLabelContext = createContext<string | undefined>(undefined);

export function useSettingLabel(own: { "aria-label"?: string; "aria-labelledby"?: string }): string | undefined {
  const row = useContext(SettingLabelContext);
  return own["aria-label"] || own["aria-labelledby"] ? undefined : row;
}
