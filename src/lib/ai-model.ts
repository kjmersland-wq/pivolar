import { anthropic } from "@ai-sdk/anthropic";

/** With ANTHROPIC_API_KEY the app talks to Claude directly; otherwise it goes through Vercel AI Gateway. */
export const chatModel = process.env.ANTHROPIC_API_KEY
  ? anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5")
  : (process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-sonnet-5.5");
