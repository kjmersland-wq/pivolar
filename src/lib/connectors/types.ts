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
  /** What a valid value looks like, so a typo is caught before it lands in the code. */
  pattern?: RegExp;
  error?: string;
};

/** The groups used in the connector list, in the order they are shown. */
export type Category = "ecommerce" | "marketing" | "messaging" | "productivity" | "sales" | "security" | "google" | "microsoft" | "aws";

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
  /** Files written straight into the project (server functions). */
  files?: (values: Record<string, string>) => FileMap;
  /** What the model builds. Gets only public values. */
  request: (values: Record<string, string>) => string;
  /** Short reminder shown before it is added. */
  after: string;
};

export const CATEGORY_LABELS: Record<Category, string> = {
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
