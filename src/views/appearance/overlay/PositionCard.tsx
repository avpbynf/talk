import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type OverlayPlacement, SPOTS, type Screen } from "@/lib/overlay";
import { cn } from "@/lib/utils";

/** Where each spot sits on the little screen, which is the arrangement of the six. */
const POSITION: Record<(typeof SPOTS)[number], string> = {
  top_left: "left-2.5 top-2.5",
  top_center: "left-1/2 top-2.5 -translate-x-1/2",
  top_right: "right-2.5 top-2.5",
  bottom_left: "bottom-2.5 left-2.5",
  bottom_center: "bottom-2.5 left-1/2 -translate-x-1/2",
  bottom_right: "bottom-2.5 right-2.5",
};

/** The screens the machine has now, read again when the window comes back to the front. */
function useScreens(): Screen[] | null {
  const [screens, setScreens] = useState<Screen[] | null>(null);
  useEffect(() => {
    const read = () =>
      invoke<Screen[]>("list_screens")
        .then(setScreens)
        .catch((error) => {
          console.warn("Failed to list the screens:", error);
          setScreens([]);
        });
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);
  return screens;
}

interface PositionCardProps {
  placement: OverlayPlacement;
  onPlacement: (patch: Partial<OverlayPlacement>) => void;
}

const CHOSEN = "chosen:";

/** The six places the overlay can be pinned to, and the screen it appears on. */
export default function PositionCard({ placement, onPlacement }: PositionCardProps) {
  const { t } = useTranslation();
  const known = useScreens();
  const screens = known ?? [];

  const named = (screen: Screen, index: number) =>
    t("appearance.overlay.position.named", { n: index + 1, width: screen.width, height: screen.height });
  const value = placement.screen === "chosen" ? `${CHOSEN}${placement.chosen_screen ?? ""}` : placement.screen;
  const gone = placement.screen === "chosen" && !screens.some((screen) => screen.id === placement.chosen_screen);

  function chooseScreen(next: string) {
    if (next.startsWith(CHOSEN)) onPlacement({ screen: "chosen", chosen_screen: next.slice(CHOSEN.length) });
    else onPlacement({ screen: next as OverlayPlacement["screen"], chosen_screen: null });
  }

  return (
    <SectionCard icon={Monitor} title={t("appearance.overlay.position.title")}>
      <SettingRow
        label={t("appearance.overlay.position.where")}
        hint={placement.spot === "free" ? t("appearance.overlay.position.free") : t("appearance.overlay.position.hint")}
      >
        <div role="group" aria-label={t("appearance.overlay.position.where")} className="relative h-[98px] w-[168px] shrink-0 rounded-[10px] bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-active)_30%,#161826),#161826)] shadow-[inset_0_0_0_1px_var(--color-border-card)]">
          {SPOTS.map((spot) => {
            const on = placement.spot === spot;
            return (
              <button
                key={spot}
                type="button"
                aria-pressed={on}
                aria-label={t(`appearance.overlay.position.spots.${spot}`)}
                onClick={() => onPlacement({ spot })}
                className={cn(
                  "absolute h-2.5 w-[34px] cursor-pointer rounded-full outline-none transition-[background,transform] duration-300 focus-visible:ring-2 focus-visible:ring-white",
                  POSITION[spot],
                  on ? "scale-[1.15] bg-[image:var(--grad-fill)]" : "bg-white/20 hover:bg-white/40",
                )}
              />
            );
          })}
        </div>
      </SettingRow>

      {known !== null && (screens.length !== 1 || placement.screen !== "typing") && (
        <SettingRow label={t("appearance.overlay.position.screen")} hint={t("appearance.overlay.position.screenHint")}>
          <Select value={value} onValueChange={chooseScreen}>
            <SelectTrigger className="w-[260px] max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="typing">{t("appearance.overlay.position.typing")}</SelectItem>
              <SelectItem value="pointer">{t("appearance.overlay.position.pointer")}</SelectItem>
              <SelectItem value="follow">{t("appearance.overlay.position.follow")}</SelectItem>
              <SelectItem value="primary">{t("appearance.overlay.position.primary")}</SelectItem>
              {screens.map((screen, index) => (
                <SelectItem key={screen.id} value={`${CHOSEN}${screen.id}`}>
                  {t("appearance.overlay.position.chosen", { name: named(screen, index) })}
                </SelectItem>
              ))}
              {gone && <SelectItem value={value}>{t("appearance.overlay.position.missing")}</SelectItem>}
            </SelectContent>
          </Select>
        </SettingRow>
      )}
    </SectionCard>
  );
}
