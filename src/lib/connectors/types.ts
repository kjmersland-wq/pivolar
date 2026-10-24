import type { FileMap } from "../files.ts";

export type Field = {
  key: string;
  label: string;
  placeholder: string;
  /** Left out of files and prompts, and shown as a password field. */
  secret?: boolean;
  /** Environment variable the published site reads the value from. */
  env?: string;
  help?: string;
  optional?: boolean;
  /** Lets the AI fill the field in from a sentence about the app. */
  suggest?: { endpoint: string; label: string; placeholder: string };
  /** Several lines instead of one. */
  multiline?: boolean;
  /** A check that is more than a pattern. Returns what is wrong, or null. */
  check?: (value: string) => string | null;
  /** What a valid value looks like, so a typo is caught before it lands in the code. */
  pattern?: RegExp;
  error?: string;
};

/** The groups used in the connector list, in the order they are shown. */
export type Category = "ecommerce" | "marketing" | "messaging" | "productivity" | "sales" | "security" | "google" | "microsoft" | "aws" | "backend";

/**
 * ready: Pivolar writes the server code itself and it is covered by tests.
 * client: only public values; the model adds a snippet to the page.
 * assisted: the model writes a server function from the service's documentation, using keys from environment variables.
 * soon: listed so the catalog matches what is wanted, not buildable yet (needs a sign-in flow).
 */
export type Kind = "ready" | "client" | "assisted" | "soon";

export type Connector = {
  id: string;
  name: string;
  category: Category;
  kind: Kind;
  summary: string;
  /** Where the owner gets the values. */
  docs: string;
  fields: Field[];
  /** Needs a Google sign-in first: the owner connects the account once, and the site gets a token for this service only. */
  oauth?: { service: "gmail" | "sheets" | "drive" | "calendar" };
  /** Files written straight into the project (server functions). */
  files?: (values: Record<string, string>) => FileMap;
  /** What the model builds. Gets only public values. */
  request: (values: Record<string, string>) => string;
  /** Short reminder shown before it is added. */
  after: string;
};

export const CATEGORY_LABELS: Record<Category, string> = {
  backend: "Backend og database",
  ecommerce: "Nettbutikk og betaling",
  marketing: "Markedsføring",
  messaging: "Meldinger og e-post",
  productivity: "Produktivitet",
  sales: "Salg",
  security: "Sikkerhet",
  google: "Google",
  microsoft: "Microsoft",
  aws: "AWS",
};

export const KIND_LABELS: Record<Kind, string> = {
  ready: "Ferdig og testet",
  client: "Enkel (offentlige verdier)",
  assisted: "AI bygger den fra dokumentasjonen",
  soon: "Kommer",
};
