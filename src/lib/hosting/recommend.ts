import type { FileMap } from "../files.ts";
import { HOSTS, type Host, type HostId } from "./catalog.ts";

/** What the site needs from a host, read from its files. */
export type Profile = {
  /** Has server functions under /api (contact form, newsletter, Google). They are written for Vercel. */
  functions: boolean;
  /** Takes payment or looks like a shop or a service sold online. Some free hosts forbid that. */
  commercial: boolean;
};

// Only signs of actual payment count. A price list or a newsletter does not make a site a shop.
const COMMERCE = /paddle|buy\.stripe\.com|checkout|cartCreate|myshopify|chargebee|woocommerce/i;

export function profileOf(files: FileMap): Profile {
  const paths = Object.keys(files);
  const code = Object.entries(files)
    .filter(([path]) => /\.(tsx?|jsx?)$/.test(path))
    .map(([, content]) => content)
    .join("\n");
  return { functions: paths.some((p) => p.startsWith("/api/")), commercial: COMMERCE.test(code) };
}

export type Fit = "best" | "ok" | "overkill" | "no";
export type Advice = { host: Host; fit: Fit; why: string };

/** Ranks the hosts for this site, with a sentence for each saying why. Worst last. */
export function advise(profile: Profile): Advice[] {
  const advice = HOSTS.map((host): Advice => {
    if (profile.functions && !host.functions) return { host, fit: "no", why: "Siden har serverfunksjoner som er skrevet for Vercel. Her måtte de skrives om først." };
    if (host.noCommerce && profile.commercial) return { host, fit: "no", why: "Siden ser ut til å selge noe, og gratis hosting hos GitHub er ikke tillatt for det." };
    if (host.id === "vercel") {
      return profile.functions
        ? { host, fit: "best", why: "Det eneste stedet serverfunksjonene dine virker uten endringer." }
        : { host, fit: "ok", why: profile.commercial ? "Raskest oppsett, men siden tar betalt, så du trenger Pro (20 USD i måneden)." : "Raskest oppsett. Gratis plan er greit hvis siden ikke er kommersiell." };
    }
    if (host.id === "cloudflare") return { host, fit: "best", why: "Rene sider er gratis og uten trafikkgrense hos Cloudflare, og de er raske i hele verden." };
    if (host.id === "netlify") return { host, fit: "ok", why: "Enkelt og gratis å starte, men trafikk trekker av en månedlig kvote." };
    if (host.id === "github-pages") return { host, fit: "ok", why: "Gratis for portefølje og info-sider. Repoet må være offentlig." };
    return { host, fit: "overkill", why: host.id === "render" ? "Du trenger ikke en egen server til en ren side." : "Mer arbeid enn nødvendig for en ren side. Passer hvis du vil ha full kontroll." };
  });
  const rank: Record<Fit, number> = { best: 0, ok: 1, overkill: 2, no: 3 };
  return advice.sort((a, b) => rank[a.fit] - rank[b.fit]);
}

export const recommended = (profile: Profile): HostId => advise(profile)[0]!.host.id;
