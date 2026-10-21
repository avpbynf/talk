import { normalizeServerUrl } from "@/lib/server";

/** What a model is worth beside its siblings, worded under `transcription.server.models`. */
export type ModelNote = "accurate" | "balanced" | "latest" | "fast" | "older";

/** A family of models of one provider, matched on their ids, with what the list says of it. */
interface Tier {
  match: RegExp;
  note: ModelNote;
}

/**
 * A transcription service that speaks the OpenAI route, offered as a suggestion for the server
 * URL. Only the ones whose `/v1/audio/transcriptions` Talk can call as it is are listed: a
 * provider with an API of its own would connect and then fail every dictation.
 */
export interface Provider {
  name: string;
  url: string;
  /** Where its keys are made, shown under the key field. */
  keyPage: string;
  /** The model it transcribes with when the field is empty, as the backend sends it. */
  defaultModel: string;
  /** Its transcription models, for when it cannot be asked. */
  models: string[];
  /** The families of its transcription models, the strongest first. An id none matches is not offered. */
  tiers: Tier[];
}

/** A model offered in the list, with its note when Talk knows the family. */
export interface ModelSuggestion {
  id: string;
  note?: ModelNote;
}

export const PROVIDERS: Provider[] = [
  {
    name: "Mistral",
    url: "https://api.mistral.ai",
    keyPage: "console.mistral.ai",
    defaultModel: "voxtral-mini-latest",
    models: ["voxtral-small-transcribe-3-0", "voxtral-mini-transcribe-3-0", "voxtral-mini-latest"],
    tiers: [
      { match: /^voxtral-small-transcribe/, note: "accurate" },
      { match: /^voxtral-mini-transcribe/, note: "balanced" },
      { match: /^voxtral-mini-latest$/, note: "latest" },
    ],
  },
  {
    name: "OpenAI",
    url: "https://api.openai.com",
    keyPage: "platform.openai.com",
    defaultModel: "whisper-1",
    models: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
    tiers: [
      { match: /^gpt-4o-transcribe/, note: "accurate" },
      { match: /^gpt-4o-mini-transcribe/, note: "balanced" },
      { match: /^whisper-1$/, note: "older" },
    ],
  },
  {
    name: "Groq",
    url: "https://api.groq.com/openai",
    keyPage: "console.groq.com",
    defaultModel: "whisper-large-v3-turbo",
    models: ["whisper-large-v3", "whisper-large-v3-turbo"],
    tiers: [
      { match: /^whisper-large-v3$/, note: "accurate" },
      { match: /^whisper-large-v3-turbo$/, note: "fast" },
    ],
  },
];

/** The provider a server URL points at, the full endpoint included. */
export function providerOf(url: string): Provider | undefined {
  const base = normalizeServerUrl(url);
  return PROVIDERS.find((provider) => base === normalizeServerUrl(provider.url));
}

/**
 * The models to suggest, the strongest first: the ones the server listed, or the ones Talk knows
 * for the provider when it could not be asked. Within a family the newest version comes first,
 * read off the numbers in the id. A Talk server is not a provider, and what it lists is offered
 * as it is.
 */
export function suggestModels(provider: Provider | undefined, listed: string[]): ModelSuggestion[] {
  if (!provider) return listed.map((id) => ({ id }));
  const tierOf = (id: string) => provider.tiers.findIndex((tier) => tier.match.test(id));
  return (listed.length > 0 ? listed : provider.models)
    .filter((id) => tierOf(id) >= 0)
    .sort((a, b) => tierOf(a) - tierOf(b) || version(b).localeCompare(version(a)))
    .map((id) => ({ id, note: provider.tiers[tierOf(id)].note }));
}

/** The numbers of an id, padded so that comparing them as text compares them as versions. */
function version(id: string): string {
  return (id.match(/\d+/g) ?? []).map((n) => n.padStart(6, "0")).join(".");
}
