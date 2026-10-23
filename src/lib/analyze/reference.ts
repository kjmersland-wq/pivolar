import type { Spec } from "./condense.ts";

export type Reference = { spec: Spec; url: string | undefined };

type Part = { type: string; state?: string; output?: { ok?: boolean; spec?: Spec; url?: string } };

/** The newest measured reference site in a conversation, or null when none was analysed. */
export function findReference(messages: { parts: unknown[] }[]): Reference | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]!.parts as Part[];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]!;
      if (part.type === "tool-analyzeSite" && part.state === "output-available" && part.output?.ok && part.output.spec) {
        return { spec: part.output.spec, url: part.output.url };
      }
    }
  }
  return null;
}
