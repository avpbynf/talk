import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { providerOf, suggestModels } from "@/lib/providers";
import { normalizeServerUrl } from "@/lib/server";

const NONE: string[] = [];

interface ModelSuggestions {
  groups: ComboboxGroup[];
  /** What the field shows when empty: the provider's default, or that the server chooses. */
  placeholder: string;
  /** The line under the field, which says so when the model typed is not offered. */
  hint: string;
  /** The provider does not offer the model typed, and the first dictation would fail on it. */
  unknown: boolean;
}

/**
 * The suggestions of a model field, for the server URL being typed. What the saved server lists
 * on `/v1/models` is asked again whenever `asked` changes (the saved URL, its key, a test), and
 * only speaks for the URL typed while that is still the saved one. The Engine page and the setup
 * wizard offer the same list.
 */
export function useModelSuggestions(url: string, savedUrl: string, asked: unknown, typed: string): ModelSuggestions {
  const { t } = useTranslation();
  const provider = providerOf(url);

  const [listed, setListed] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    setListed([]);
    invoke<string[]>("list_server_models")
      .then((ids) => {
        if (current && Array.isArray(ids)) setListed(ids);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [savedUrl, asked]);

  const own = normalizeServerUrl(savedUrl) === normalizeServerUrl(url) ? listed : NONE;
  const models = useMemo(() => suggestModels(provider, own), [provider, own]);
  const groups = useMemo<ComboboxGroup[]>(
    () => [
      {
        label: provider
          ? t("transcription.server.modelsOf", { name: provider.name })
          : t("transcription.server.modelsOfServer"),
        items: models.map((model) => ({
          value: model.id,
          label: model.id,
          detail: model.note && t(`transcription.server.models.${model.note}`),
          tag: model.id === provider?.defaultModel ? t("transcription.server.defaultModel") : undefined,
        })),
      },
    ],
    [provider, models, t],
  );

  // What the provider listed is the authority, a family Talk does not rank yet included.
  const id = typed.trim();
  const unknown =
    !!provider && id !== "" && !(own.length > 0 ? own.includes(id) : models.some((model) => model.id === id));

  return {
    groups,
    placeholder: provider?.defaultModel ?? t("transcription.server.serverChooses"),
    hint: unknown
      ? t("transcription.server.modelUnknown", { name: provider!.name })
      : provider
        ? t("transcription.server.modelDefault", { name: provider.name, model: provider.defaultModel })
        : t("transcription.server.modelHint"),
    unknown,
  };
}
