/**
 * Cost estimates for the usage meter. These are estimates from token counts and a price list kept
 * here, not invoices: the provider's own figure is always the one that counts. Prices can be
 * overridden with PRICE_INPUT_PER_MTOK, PRICE_OUTPUT_PER_MTOK and PRICE_IMAGE_USD.
 */

export type Prices = { inputPerMTok: number; outputPerMTok: number; imageUsd: number };
type Env = Record<string, string | undefined>;

/** Used when the model is not recognised: Sonnet-class pricing, which keeps the estimate on the cautious side. */
export const DEFAULT_PRICES: Prices = { inputPerMTok: 3, outputPerMTok: 15, imageUsd: 0.04 };

const positive = (value: string | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && value?.trim() ? n : undefined;
};

export function pricesFor(env: Env = process.env): Prices {
  return {
    inputPerMTok: positive(env.PRICE_INPUT_PER_MTOK) ?? DEFAULT_PRICES.inputPerMTok,
    outputPerMTok: positive(env.PRICE_OUTPUT_PER_MTOK) ?? DEFAULT_PRICES.outputPerMTok,
    imageUsd: positive(env.PRICE_IMAGE_USD) ?? DEFAULT_PRICES.imageUsd,
  };
}

const round = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

/** Cost of one chat request. Cached input is billed lower by providers, so this runs slightly high. */
export function chatCost(inputTokens: number, outputTokens: number, prices: Prices) {
  return {
    input: round((Math.max(inputTokens, 0) / 1_000_000) * prices.inputPerMTok),
    output: round((Math.max(outputTokens, 0) / 1_000_000) * prices.outputPerMTok),
  };
}

export function imageCost(prices: Prices) {
  return round(prices.imageUsd);
}

/** Providers bill cached input at a fraction of the normal price, and writing to the cache at a premium. */
export const CACHE_READ_FACTOR = 0.1;
export const CACHE_WRITE_FACTOR = 1.25;

export type ChatUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: { noCacheTokens?: number | undefined; cacheReadTokens?: number | undefined; cacheWriteTokens?: number | undefined } | undefined;
};

/** Cost of one request, taking prompt caching into account. Tokens are the plain totals. */
export function chatCostDetailed(usage: ChatUsage, prices: Prices) {
  const input = Math.max(usage.inputTokens ?? 0, 0);
  const output = Math.max(usage.outputTokens ?? 0, 0);
  const read = Math.max(usage.inputTokenDetails?.cacheReadTokens ?? 0, 0);
  const write = Math.max(usage.inputTokenDetails?.cacheWriteTokens ?? 0, 0);
  const plain = usage.inputTokenDetails?.noCacheTokens ?? Math.max(input - read - write, 0);
  const inputCost = round(((plain + read * CACHE_READ_FACTOR + write * CACHE_WRITE_FACTOR) / 1_000_000) * prices.inputPerMTok);
  const outputCost = round((output / 1_000_000) * prices.outputPerMTok);
  return { input: inputCost, output: outputCost, total: round(inputCost + outputCost), inputTokens: input, outputTokens: output, cachedTokens: read };
}
