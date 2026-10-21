import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { PROVIDERS } from "@/lib/providers";
import { useDiscoveredServers } from "@/lib/use-discovered-servers";
import type { DiscoveredServer } from "@/lib/server";

/**
 * The suggestions of a server URL field: the Talk servers found on the network, then the
 * providers Talk knows. The Engine page and the setup wizard offer the same list.
 */
export function useServerSuggestions(): { groups: ComboboxGroup[]; discovered: DiscoveredServer[] } {
  const { t } = useTranslation();
  const discovered = useDiscoveredServers();
  const groups = useMemo<ComboboxGroup[]>(
    () => [
      {
        label: t("transcription.server.onNetwork"),
        items: discovered.map((server) => ({
          value: server.url,
          label: server.name,
          detail: server.model ? `${server.model}, ${server.url}` : server.url,
        })),
      },
      {
        label: t("transcription.server.providers"),
        items: PROVIDERS.map((provider) => ({ value: provider.url, label: provider.name, detail: provider.url })),
      },
    ],
    [discovered, t],
  );
  return { groups, discovered };
}
