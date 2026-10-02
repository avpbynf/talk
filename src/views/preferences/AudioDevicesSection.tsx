import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Mic, RefreshCw, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SYSTEM_DEFAULT = "__default__";

export default function AudioDevicesSection() {
  const { t } = useTranslation();
  const [inputs, setInputs] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [selectedInput, setSelectedInput] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<string | null>(null);
  const [defaultInput, setDefaultInput] = useState<string | null>(null);
  const [defaultOutput, setDefaultOutput] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<"input" | "output" | null>(null);
  const refreshTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const readInputs = () => {
    invoke<string[]>("list_input_devices").then(setInputs).catch(() => {});
    invoke<string | null>("get_default_input_device").then(setDefaultInput).catch(() => {});
  };

  const readOutputs = () => {
    invoke<string[]>("list_output_devices").then(setOutputs).catch(() => {});
    invoke<string | null>("get_default_output_device").then(setDefaultOutput).catch(() => {});
  };

  useEffect(() => {
    readInputs();
    readOutputs();
    invoke<string | null>("get_input_device").then(setSelectedInput).catch(() => {});
    invoke<string | null>("get_output_device").then(setSelectedOutput).catch(() => {});

    return () => {
      if (refreshTimeout.current) {
        clearTimeout(refreshTimeout.current);
      }
    };
  }, []);

  // The spin is what says the button did something, since a list that comes back
  // identical looks like nothing happened at all.
  const refresh = (which: "input" | "output") => {
    setRefreshing(which);
    clearTimeout(refreshTimeout.current);
    if (which === "input") {
      readInputs();
    } else {
      readOutputs();
    }
    refreshTimeout.current = setTimeout(() => setRefreshing(null), 600);
  };

  const changeInput = async (value: string) => {
    const deviceName = value === SYSTEM_DEFAULT ? null : value;
    setSelectedInput(deviceName);
    await invoke("set_input_device", { deviceName });
  };

  const changeOutput = async (value: string) => {
    const deviceName = value === SYSTEM_DEFAULT ? null : value;
    setSelectedOutput(deviceName);
    await invoke("set_output_device", { deviceName });
  };

  return (
    <SectionCard icon={Volume2} title={t("preferences.audio.title")} className="gap-5">
      <DeviceRow
        icon={<Mic className="h-4 w-4 text-[var(--color-active)]" />}
        label={t("preferences.audio.microphone")}
        hint={t("preferences.audio.microphoneHint")}
        devices={inputs}
        selected={selectedInput}
        defaultName={defaultInput}
        isRefreshing={refreshing === "input"}
        onOpen={readInputs}
        onChange={changeInput}
        onRefresh={() => refresh("input")}
      />

      <DeviceRow
        icon={<Volume2 className="h-4 w-4 text-[var(--color-active)]" />}
        label={t("preferences.audio.output")}
        hint={t("preferences.audio.outputHint")}
        devices={outputs}
        selected={selectedOutput}
        defaultName={defaultOutput}
        isRefreshing={refreshing === "output"}
        onOpen={readOutputs}
        onChange={changeOutput}
        onRefresh={() => refresh("output")}
      />
    </SectionCard>
  );
}

interface DeviceRowProps {
  icon: React.ReactNode;
  label: string;
  hint: string;
  devices: string[];
  selected: string | null;
  defaultName: string | null;
  isRefreshing: boolean;
  onOpen: () => void;
  onChange: (value: string) => void;
  onRefresh: () => void;
}

function DeviceRow({
  icon,
  label,
  hint,
  devices,
  selected,
  defaultName,
  isRefreshing,
  onOpen,
  onChange,
  onRefresh,
}: DeviceRowProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground truncate">{hint}</span>
        </div>
        <span className="text-[11px] text-muted-foreground/60 font-mono shrink-0">
          {t("preferences.audio.devices", { count: devices.length })}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-[var(--color-active)]/10 border border-[var(--color-active)]/20 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <Select
          value={selected ?? SYSTEM_DEFAULT}
          onValueChange={onChange}
          onOpenChange={(open) => {
            // A device plugged in while this page is open would otherwise be missing
            // from a list read once at mount.
            if (open) onOpen();
          }}
        >
          <SelectTrigger className="w-full bg-surface-inset border-border-card">
            <SelectValue placeholder={t("preferences.audio.systemDefault")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SYSTEM_DEFAULT}>
              {defaultName
                ? t("preferences.audio.systemDefaultNamed", { name: defaultName })
                : t("preferences.audio.systemDefault")}
            </SelectItem>
            {devices.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="cursor-pointer h-9 w-9 shrink-0 rounded-lg border border-border-card bg-surface-inset flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-active transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("preferences.audio.refresh")}
        >
          <RefreshCw className={`h-3.5 w-3.5 transition-transform ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}
