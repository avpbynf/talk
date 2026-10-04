import { useEffect, useState, type ReactNode } from "react";
import { Palette, Plus, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PRESETS,
  type PresetGroup,
  type SavedTheme,
  type ThemeValues,
  gradientCss,
} from "@/lib/theme";
import type { AppThemeController } from "@/lib/use-app-theme";

function Preview({ values }: { values: ThemeValues }) {
  const gradient = gradientCss(values.stops, values.angle, values.kind);
  return (
    <span className="relative block h-[70px] overflow-hidden rounded-[var(--radius)]" style={{ background: values.bg }}>
      <span
        className="absolute -top-[30%] -right-[10%] block aspect-square w-4/5 rounded-full opacity-55 blur-[16px]"
        style={{ backgroundImage: gradient }}
      />
      <span
        className="absolute inset-x-2.5 bottom-2.5 block h-[26px] rounded-md"
        style={{ background: values.card, boxShadow: "0 0 0 1px rgb(127 127 127 / 0.15)" }}
      >
        <span className="absolute left-[7px] top-[7px] block h-1 w-[34px] rounded-full opacity-70" style={{ background: values.fg }} />
        <span className="absolute right-[7px] top-1.5 block h-3.5 w-[26px] rounded-full" style={{ backgroundImage: gradient }} />
      </span>
    </span>
  );
}

function Tile({
  name,
  hint,
  values,
  on,
  onSelect,
  onRemove,
}: {
  name: string;
  hint?: string;
  values: ThemeValues;
  on: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group/tile relative">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={on}
        className="flex w-full flex-col gap-[7px] text-left outline-none transition-transform duration-300 hover:-translate-y-[3px] active:scale-[0.96] focus-visible:[&>span:first-child]:outline-2 focus-visible:[&>span:first-child]:outline-offset-[3px] focus-visible:[&>span:first-child]:outline-ring"
      >
        <span
          className={cn(
            "block rounded-[var(--radius)] shadow-[0_0_0_1px_var(--line)] transition-shadow duration-300",
            on && "shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--s1)]",
          )}
        >
          <Preview values={values} />
        </span>
        <span className="flex items-center justify-between gap-1.5 text-xs font-medium">
          <span className="truncate">{name}</span>
          {hint && <small className="shrink-0 text-[11px] font-normal text-muted-foreground">{hint}</small>}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("appearance.theme.remove", { name })}
          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-background/80 text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/tile:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

const GROUPS: PresetGroup[] = ["gradients", "classics"];

/**
 * A button drawn in colours of its own, whatever the theme: it is how a look that went wrong
 * is undone, so nothing about the look may reach it.
 */
function FixedButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-[30px] items-center gap-2 whitespace-nowrap rounded-[6px] border border-[#9ca3af] bg-[#1f2937] px-3 text-xs font-medium text-white hover:bg-[#374151] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f59e0b] [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/** How long the undo line stays under the grid. */
const UNDO_MS = 6000;

export default function PresetGrid({ theme }: { theme: AppThemeController }) {
  const { t } = useTranslation();
  const { setting, saved, resolved } = theme;
  const [removed, setRemoved] = useState<{ theme: SavedTheme; index: number } | null>(null);

  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [removed]);

  const removeSaved = (mine: SavedTheme) => {
    setRemoved({ theme: mine, index: saved.findIndex((s) => s.id === mine.id) });
    theme.remove(mine.id);
  };

  const undo = () => {
    if (!removed) return;
    theme.restore(removed.theme, removed.index);
    setRemoved(null);
  };

  return (
    <SectionCard
      icon={Palette}
      title={t("appearance.theme.title")}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {resolved.edited && (
            <>
              <span className="rounded-full bg-[image:var(--grad-fill)] px-2.5 py-0.5 text-[11px] font-medium text-on-accent">
                {t("appearance.theme.edited")}
              </span>
              <FixedButton onClick={theme.revert}>
                <RotateCcw />
                {t("appearance.theme.revert")}
              </FixedButton>
            </>
          )}
          <FixedButton onClick={theme.reset}>{t("appearance.theme.reset")}</FixedButton>
          <Button
            variant="outline"
            size="sm"
            disabled={!resolved.edited}
            title={resolved.edited ? undefined : t("appearance.theme.saveUnchanged")}
            onClick={() => theme.save((n) => t("appearance.theme.savedName", { n }))}
          >
            <Plus />
            {t("appearance.theme.save")}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5">
        {saved.length > 0 && (
          <>
            <Heading>{t("appearance.theme.yours")}</Heading>
            {saved.map((mine) => (
              <Tile
                key={mine.id}
                name={mine.name}
                hint={t("appearance.theme.mine")}
                values={mine.values}
                on={setting.preset === mine.id}
                onSelect={() => theme.choose(mine.id)}
                onRemove={() => removeSaved(mine)}
              />
            ))}
          </>
        )}
        {GROUPS.map((group) => (
          <Group key={group} group={group} theme={theme} />
        ))}
      </div>
      {theme.problem && (
        <p role="alert" className="text-xs text-warning">
          {theme.problem}
        </p>
      )}
      {removed && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("appearance.theme.removed", { name: removed.theme.name })}
          <button onClick={undo} className="font-medium text-[var(--color-active)] hover:underline">
            {t("appearance.theme.undo")}
          </button>
        </p>
      )}
    </SectionCard>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <div className="col-span-full pt-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
      {children}
    </div>
  );
}

function Group({ group, theme }: { group: PresetGroup; theme: AppThemeController }) {
  const { t } = useTranslation();
  return (
    <>
      <Heading>{t(`appearance.theme.groups.${group}`)}</Heading>
      {PRESETS.filter((p) => p.group === group).map((p) => (
        <Tile
          key={p.id}
          name={t(`appearance.presets.${p.id}`)}
          hint={p.values.mode === "light" ? t("appearance.theme.light") : undefined}
          values={p.values}
          on={theme.setting.preset === p.id}
          onSelect={() => theme.choose(p.id)}
        />
      ))}
    </>
  );
}
