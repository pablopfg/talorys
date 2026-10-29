/**
 * Chat model providers. Workers AI runs on the owner's Cloudflare account; Anthropic and OpenAI
 * are paid APIs reached with the owner's own key (Worker secrets ANTHROPIC_API_KEY and
 * OPENAI_API_KEY) and capped by `limits.maxPaidAiUsdPerDay`.
 */
export const AI_PROVIDERS = ["workers-ai", "anthropic", "openai"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];
export type PaidAiProviderId = Exclude<AiProviderId, "workers-ai">;
export const PAID_AI_PROVIDERS = ["anthropic", "openai"] as const satisfies readonly PaidAiProviderId[];

/** "none": no fallback; otherwise the provider used when the main one fails before answering. */
export const AI_FALLBACKS = ["none", ...AI_PROVIDERS] as const;
export type AiFallback = (typeof AI_FALLBACKS)[number];

export interface PaidModel {
  id: string;
  label: string;
  /** USD per million tokens: input, cached input read, output. */
  usdPerMillion: { input: number; cachedInput: number; output: number };
  /** Some reasoning models reject a temperature; it is never sent to them. */
  temperature: boolean;
}

/**
 * Only listed models can be chosen, so the daily cap in US$ can always be applied. Prices are the
 * providers' list prices on `PAID_MODEL_PRICES_AS_OF`; check them again when adding a model.
 */
export const PAID_MODELS = {
  anthropic: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", usdPerMillion: { input: 4, cachedInput: 0.2, output: 20 }, temperature: false },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", usdPerMillion: { input: 2, cachedInput: 0.2, output: 10 }, temperature: false },
    // Up to 100K-token prompts; Talorys' context cap (32K) stays below that.
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", usdPerMillion: { input: 0.1, cachedInput: 0.01, output: 0.5 }, temperature: false },
  ],
  openai: [
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", usdPerMillion: { input: 2, cachedInput: 0.1, output: 10 }, temperature: false },
    { id: "gpt-6-sol", label: "GPT-6 Sol", usdPerMillion: { input: 2, cachedInput: 0.2, output: 10 }, temperature: false },
    { id: "gpt-6-luna", label: "GPT-6 Luna", usdPerMillion: { input: 0.1, cachedInput: 0.01, output: 0.5 }, temperature: false },
    { id: "gpt-6-astra", label: "GPT-6 Astra", usdPerMillion: { input: 10, cachedInput: 1, output: 50 }, temperature: false },
  ],
} as const satisfies Record<PaidAiProviderId, readonly PaidModel[]>;

export const PAID_MODEL_PRICES_AS_OF = "2026-10-29";

export type AnthropicModelId = (typeof PAID_MODELS.anthropic)[number]["id"];
export type OpenAiModelId = (typeof PAID_MODELS.openai)[number]["id"];
export const ANTHROPIC_MODEL_IDS = PAID_MODELS.anthropic.map((m) => m.id) as [AnthropicModelId, ...AnthropicModelId[]];
export const OPENAI_MODEL_IDS = PAID_MODELS.openai.map((m) => m.id) as [OpenAiModelId, ...OpenAiModelId[]];
export const DEFAULT_ANTHROPIC_MODEL: AnthropicModelId = "claude-opus-5-5";
export const DEFAULT_OPENAI_MODEL: OpenAiModelId = "gpt-6.1-sol";

/** How usage records name a paid model: "anthropic/claude-opus-5-5". Workers AI ids start with "@". */
export function paidModelKey(provider: PaidAiProviderId, model: string): string {
  return `${provider}/${model}`;
}

/** The listed model behind a usage key, or null (a Workers AI model, or one no longer listed). */
export function paidModel(key: string): PaidModel | null {
  const slash = key.indexOf("/");
  const provider = key.slice(0, slash);
  if (slash < 1 || !(PAID_AI_PROVIDERS as readonly string[]).includes(provider)) return null;
  const models: readonly PaidModel[] = PAID_MODELS[provider as PaidAiProviderId];
  return models.find((m) => m.id === key.slice(slash + 1)) ?? null;
}
