/**
 * Verified API prices, in USD per million tokens. A price is a dated fact with
 * a source, not a constant to tune: re-verify before relying on it for a budget.
 *
 * Reasoning tokens are billed as output tokens and are included in
 * `usage.output_tokens` by the Responses API.
 */
export type ModelPrice = {
  model: string;
  input: number;
  cachedInput: number;
  /** Charged for prompt-cache writes where the provider reports or applies them. */
  cacheWrite: number;
  output: number;
  /** Prompts above this many input tokens use the long-context multipliers. */
  longContextThreshold: number;
  longInputMultiplier: number;
  longOutputMultiplier: number;
  source: string;
  verifiedAt: string;
};

export const GPT6_LUNA: ModelPrice = {
  model: "gpt-6-luna",
  input: 0.1,
  cachedInput: 0.01,
  cacheWrite: 0.125,
  output: 0.5,
  longContextThreshold: 272_000,
  longInputMultiplier: 2,
  longOutputMultiplier: 1.5,
  source: "https://developers.openai.com/api/docs/models/gpt-6-luna",
  verifiedAt: "2026-09-22",
};

export type ResponsesUsage = {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
  output_tokens_details?: { reasoning_tokens?: number } | null;
};

function validUsage(u: ResponsesUsage | null | undefined): u is ResponsesUsage {
  const ok = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  return !!u && ok(u.input_tokens) && ok(u.output_tokens)
    && (u.input_tokens_details?.cached_tokens === undefined || ok(u.input_tokens_details.cached_tokens));
}

/**
 * Cost in integer micro-dollars, rounded up. `standard` bills all uncached input
 * at the input rate. `conservative` bills reported `cache_write_tokens` at the
 * cache-write rate; when a response does not report writes, it assumes every
 * uncached token was a write. Budgets settle at the conservative figure;
 * provider billing is authoritative.
 */
export function costMicros(price: ModelPrice, usage: ResponsesUsage, basis: "standard" | "conservative" = "conservative"): number {
  if (!validUsage(usage)) throw new Error("invalid usage: cost cannot be settled");
  const cached = Math.min(usage.input_tokens, usage.input_tokens_details?.cached_tokens ?? 0);
  const uncached = usage.input_tokens - cached;
  const reportedWrites = usage.input_tokens_details?.cache_write_tokens;
  const writes = basis === "standard" ? 0
    : Number.isSafeInteger(reportedWrites) && reportedWrites! >= 0 ? Math.min(uncached, reportedWrites!) : uncached;
  const long = usage.input_tokens > price.longContextThreshold;
  const inMul = long ? price.longInputMultiplier : 1, outMul = long ? price.longOutputMultiplier : 1;
  const dollarsTimesMillion = (uncached - writes) * price.input * inMul
    + writes * Math.max(price.input, price.cacheWrite) * inMul
    + cached * price.cachedInput * inMul
    + usage.output_tokens * price.output * outMul;
  return Math.ceil(dollarsTimesMillion);
}

/** Worst case for a request bounded by `inputTokens` and `maxOutputTokens`. */
export function reservationMicros(price: ModelPrice, inputTokens: number, maxOutputTokens: number): number {
  if (!(inputTokens > 0 && maxOutputTokens > 0)) throw new Error("reservation needs positive token bounds");
  const long = inputTokens > price.longContextThreshold;
  return Math.ceil(inputTokens * Math.max(price.input, price.cacheWrite) * (long ? price.longInputMultiplier : 1)
    + maxOutputTokens * price.output * (long ? price.longOutputMultiplier : 1));
}

/**
 * Upper bound on image input tokens for patch-tokenized models at original
 * detail: 32px patches times a multiplier. OpenAI does not publish Luna's
 * multiplier, so callers pass a deliberately high one and settlement verifies
 * the observed count never exceeds the bound.
 */
export function imageTokenBound(width: number, height: number, multiplier = 2): number {
  if (!(width > 0 && height > 0)) throw new Error("image dimensions required");
  return Math.ceil(Math.ceil(width / 32) * Math.ceil(height / 32) * multiplier);
}
