import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatAgo, formatNumber } from "@/i18n";
import { formatTimeSaved, loadUserWpm } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/SectionCard";

interface Device {
  id: string;
  name: string;
  isThisDevice: boolean;
  timeSavedMinutes: number;
  dictations: number;
  lastSeenMs: number | null;
}

const MAX_NAME = 60;
const RENAME_ERRORS = ["invalid_name", "unknown_device", "failed"];

/** Every machine signed in to the account, this one first, with a way to name each. */
export function DevicesCard() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [listFailed, setListFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [returnFocusTo, setReturnFocusTo] = useState<string | null>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());

  const load = useCallback(() => {
    return invoke<Device[]>("list_devices", { userWpm: loadUserWpm() })
      .then((list) => {
        setDevices(list ?? []);
        setListFailed(false);
      })
      .catch(() => setListFailed(true));
  }, []);

  useEffect(() => {
    void load();
    const finished = listen("sync-finished", () => void load());
    return () => {
      finished.then((stop) => stop());
    };
  }, [load]);

  // The form is gone from the page by now, so the button it came from exists again.
  // It is looked up here by device, since a rename can have moved the row.
  useEffect(() => {
    if (editing === null && returnFocusTo !== null) {
      renameButtons.current.get(returnFocusTo)?.focus();
      setReturnFocusTo(null);
    }
  }, [editing, returnFocusTo, devices]);

  function detail(device: Device): string {
    const time = formatTimeSaved(device.timeSavedMinutes);
    if (device.isThisDevice || device.lastSeenMs === null) {
      return t("account.devices.thisDetail", {
        time,
        count: device.dictations,
        number: formatNumber(device.dictations),
      });
    }
    return t("account.devices.seenDetail", { time, ago: formatAgo(device.lastSeenMs) });
  }

  function startRename(device: Device) {
    setEditing(device.id);
    setDraft(device.name);
    setFailure(null);
  }

  function closeForm() {
    setReturnFocusTo(editing);
    setEditing(null);
    setFailure(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (editing === null || name === "") return;
    if ([...name].length > MAX_NAME) {
      setFailure(t("account.devices.errors.invalid_name"));
      return;
    }
    try {
      await invoke("rename_device", { deviceId: editing, name });
      await load();
      closeForm();
    } catch (error) {
      const code = RENAME_ERRORS.includes(String(error)) ? String(error) : "failed";
      setFailure(t(`account.devices.errors.${code}`));
    }
  }

  if (devices.length === 0 && !listFailed) return null;

  return (
    <SectionCard icon={Monitor} title={t("account.devices.title")}>
      {devices.map((device) => (
        <div key={device.id} className="flex flex-wrap items-center gap-3" data-testid="device-row">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-[var(--tint)] text-[var(--color-active)]">
            <Monitor className="h-[18px] w-[18px]" />
          </span>

          {editing === device.id ? (
            <form onSubmit={save} className="flex min-w-0 flex-[1_1_220px] flex-wrap items-center gap-2">
              <Input
                autoFocus
                aria-label={t("account.devices.nameLabel")}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeForm();
                  }
                }}
                className="min-w-0 flex-1"
              />
              <Button type="submit" size="sm" disabled={draft.trim() === ""}>
                {t("account.devices.save")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={closeForm}>
                {t("account.devices.cancel")}
              </Button>
            </form>
          ) : (
            <>
              <div className="flex min-w-0 flex-[1_1_180px] flex-col">
                <b className="break-words text-[13px] font-semibold">{device.name}</b>
                <small className="text-xs text-muted-foreground">{detail(device)}</small>
              </div>
              {device.isThisDevice && (
                <span className="whitespace-nowrap rounded-full bg-[color-mix(in_oklch,var(--color-success)_16%,transparent)] px-[9px] py-[3px] text-[11px] font-medium text-[var(--color-success)]">
                  {t("account.devices.here")}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                ref={(button) => {
                  if (button) renameButtons.current.set(device.id, button);
                  else renameButtons.current.delete(device.id);
                }}
                aria-label={t("account.devices.renameNamed", { name: device.name })}
                onClick={() => startRename(device)}
              >
                {t("account.devices.rename")}
              </Button>
            </>
          )}
        </div>
      ))}
      {listFailed && <p className="text-sm text-destructive">{t("account.devices.listFailed")}</p>}
      {failure && <p className="text-sm text-destructive">{failure}</p>}
    </SectionCard>
  );
}
