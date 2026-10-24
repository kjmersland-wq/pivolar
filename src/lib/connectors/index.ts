import { CATALOG } from "./catalog.ts";
import { READY, SUBSCRIBE_FUNCTION } from "./ready.ts";
import type { Category, Connector } from "./types.ts";

export { CATEGORY_LABELS, KIND_LABELS, type Category, type Connector, type Field, type Kind } from "./types.ts";
export { SUBSCRIBE_FUNCTION };

/**
 * Connectors: links to outside services. Each one says what it needs from the owner (public
 * values and secrets), which files it adds to the project and what the model builds on top. Secrets
 * never go into files or prompts: they stay with the owner and are given to the published site as
 * environment variables.
 */

export const CONNECTORS: Connector[] = [...READY, ...CATALOG];

/** Categories in the order they are shown. */
export const CATEGORIES: Category[] = ["ecommerce", "marketing", "messaging", "productivity", "sales", "google", "microsoft", "security", "aws"];

/** The only environment variables a published site may receive, so nothing else can be sent along. */
export const ENV_NAMES: string[] = [...new Set(CONNECTORS.flatMap((c) => c.fields.flatMap((f) => (f.env ? [f.env] : []))))];

const clean = (value: string | undefined) => (value ?? "").trim();

export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id);

/** Picks the allowed, non-empty environment variables out of whatever the browser sent. */
export function pickEnv(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const name of ENV_NAMES) {
    const value = (input as Record<string, unknown>)[name];
    if (typeof value === "string" && value.trim() && value.length < 500) out[name] = value.trim();
  }
  return out;
}

/** What is missing before the connector can be added. */
export function missingFields(connector: Connector, values: Record<string, string>): string[] {
  return connector.fields.filter((f) => !f.optional && !clean(values[f.key])).map((f) => f.label);
}

/** Values the page may know about: everything except the secrets. */
export function publicValues(connector: Connector, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(connector.fields.filter((f) => !f.secret).map((f) => [f.key, clean(values[f.key])]));
}

/** Environment variables the published site needs, read from what the owner entered. */
export function envFor(values: Record<string, Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const connector of CONNECTORS) {
    for (const field of connector.fields) {
      const value = clean(values[connector.id]?.[field.key]);
      if (field.env && value) env[field.env] = value;
    }
  }
  return pickEnv(env);
}

/** Checks what the owner typed against each field's pattern, so a typo is caught before it lands in the code. */
export function validate(connector: Connector, values: Record<string, string>): string | null {
  for (const field of connector.fields) {
    const value = clean(values[field.key]);
    if (value && field.pattern && !field.pattern.test(value)) return field.error ?? `${field.label} ser ikke riktig ut.`;
  }
  return null;
}

/** Search over name, summary and category; every word has to match. */
export function searchConnectors(query: string, list: Connector[] = CONNECTORS): Connector[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list.filter((c) => {
    const haystack = `${c.name} ${c.summary} ${c.id}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
