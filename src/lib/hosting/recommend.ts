import type { FileMap } from "../files.ts";
import { classifyStack, type Classification } from "../stack/classify.ts";
import type { HostId } from "./catalog.ts";
import { rank, type Advice, type Fit, type Profile as RulesProfile } from "./rules.ts";

export type { Advice, Fit };
export type Profile = RulesProfile;

// Only signs of actual payment count. A price list or a newsletter does not make a site a shop.
const COMMERCE = /paddle|buy\.stripe\.com|checkout|cartCreate|myshopify|chargebee|woocommerce/i;

/** What the site needs from a host, read from its files by the stack classification and a scan for payment. */
export function profileOf(files: FileMap): Profile & { classification: Classification } {
  const classification = classifyStack(files);
  const code = Object.entries(files)
    .filter(([path]) => /\.(tsx?|jsx?)$/.test(path))
    .map(([, content]) => content)
    .join("\n");
  return { functions: classification.functions, commercial: COMMERCE.test(code), stack: classification.stack, delivery: classification.delivery, classification };
}

/** Ranks the hosts for this site, with a sentence for each saying why. Worst last. */
export const advise = (profile: Profile): Advice[] => rank(profile);

export const recommended = (profile: Profile): HostId => advise(profile)[0]!.host.id;
