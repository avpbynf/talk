import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

export type Language = "en" | "fr";
/** What the setting stores: a language, or null to follow the system. */
export type LanguageSetting = Language | null;

export function resolveLanguage(setting: string | null | undefined): Language {
  const code = setting ?? (typeof navigator === "undefined" ? "en" : navigator.language);
  return code.toLowerCase().startsWith("fr") ? "fr" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: resolveLanguage(null),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** The BCP 47 tag the Intl formatters should use for the current language. */
export function locale(): string {
  return i18n.language === "fr" ? "fr-FR" : "en-US";
}

function apply(setting: string | null) {
  const language = resolveLanguage(setting);
  void i18n.changeLanguage(language);
  document.documentElement.lang = language;
  invoke("sync_tray_language", { resolved: language }).catch(() => {});
}

/** Follows the saved choice, and any change of it made from another window. */
export async function startLanguageSync(): Promise<void> {
  apply(await invoke<string | null>("get_language").catch(() => null));
  await listen<string | null>("language-changed", (event) => apply(event.payload));
}

export async function setLanguageSetting(setting: LanguageSetting): Promise<void> {
  await invoke("set_language", { language: setting });
}

/** A number with its digits grouped the way the interface language groups them. */
export function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString(locale(), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatUsd(value: number, fractionDigits = 2): string {
  return value.toLocaleString(locale(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

/** When something happened, as a distance from now in the interface language. */
export function formatAgo(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 1) return i18n.t("account.devices.justNow");
  const relative = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  if (minutes < 60) return relative.format(-minutes, "minute");
  if (minutes < 24 * 60) return relative.format(-Math.round(minutes / 60), "hour");
  return relative.format(-Math.round(minutes / (24 * 60)), "day");
}

export default i18n;
