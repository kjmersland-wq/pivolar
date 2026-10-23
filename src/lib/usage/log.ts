import type { SupabaseClient } from "@supabase/supabase-js";
import { chatCostDetailed, imageCost, pricesFor, type ChatUsage } from "./pricing.ts";

/**
 * Writes the owner's usage rows with their own session (row-level security allows own rows only).
 * Logging must never break the feature it measures, so every failure is swallowed.
 */
export async function logChatUsage(supabase: SupabaseClient, userId: string, usage: ChatUsage) {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  if (input <= 0 && output <= 0) return;
  const cost = chatCostDetailed(usage, pricesFor());
  try {
    await supabase.from("usage").insert([
      { owner_id: userId, kind: "ai_input_tokens", units: input, estimated_cost_usd: cost.input },
      { owner_id: userId, kind: "ai_output_tokens", units: output, estimated_cost_usd: cost.output },
    ]);
  } catch {
    /* the meter is a convenience */
  }
}

export async function logImageUsage(supabase: SupabaseClient, userId: string) {
  try {
    await supabase.from("usage").insert({ owner_id: userId, kind: "ai_image", units: 1, estimated_cost_usd: imageCost(pricesFor()) });
  } catch {
    /* the meter is a convenience */
  }
}
