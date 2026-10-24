import type { Delivery, Stack } from "../stack/classify.ts";
import { HOSTS, hostById, type Host, type HostId, type Money } from "./catalog.ts";

/**
 * The fixed rules that match a project to a host: one table from stack and delivery to a fit per
 * host, two overrides, and the price. No AI is involved, so the same project gets the same advice
 * every time and the advice costs nothing.
 */

export type Fit = "best" | "ok" | "overkill" | "no";

/** What the rules need to know about a project. */
export type Profile = {
  /** Has server functions under /api (contact form, newsletter, Google). They are written for Vercel. */
  functions: boolean;
  /** Takes payment or looks like a shop or a service sold online. Some free hosts forbid that. */
  commercial: boolean;
  stack?: Stack | undefined;
  delivery?: Delivery | undefined;
};

type Why = string | ((profile: Profile) => string);
type Row = Partial<Record<HostId, [Fit, Why]>>;

const FILES: Row = {
  cloudflare: ["best", "Filene på siden er gratis og uten trafikkgrense hos Cloudflare, og de er raske i hele verden."],
  netlify: ["ok", "Enkelt og gratis å starte, men trafikk trekker av en månedlig kvote."],
  "github-pages": ["ok", "Gratis for portefølje og info-sider. Repoet må være offentlig."],
  vercel: ["ok", (p) => (p.commercial ? "Raskest oppsett, men siden tar betalt, så du trenger Pro (20 USD i måneden)." : "Raskest oppsett. Gratis plan er greit hvis siden ikke er kommersiell.")],
  render: ["overkill", "Du trenger ikke en egen server til en side som bare er filer."],
  railway: ["overkill", "Du trenger ikke en egen server til en side som bare er filer."],
  hetzner: ["overkill", "Mer arbeid enn nødvendig for en side som bare er filer. Passer hvis du vil ha full kontroll."],
};

/** The stack and delivery that a project is classified as, to the fit of each host. */
export const TABLE: Record<string, Row> = {
  "static/files": FILES,
  "frontend/files": FILES,
  "frontend/ssr": {
    vercel: ["best", "Laget for rammeverk som rendrer sider på serveren, og krever ingen oppsett."],
    netlify: ["ok", "Støtter serverrendering, men trafikk og kjøring trekker av en månedlig kvote."],
    cloudflare: ["ok", "Virker for mange rammeverk, men kan kreve en tilpasning av prosjektet."],
    render: ["ok", "En ekte server med fast pris. Litt mer oppsett enn Vercel."],
    railway: ["ok", "En ekte server med bruksbasert pris."],
    hetzner: ["ok", "Billigst per måned og i Europa, men du driver serveren selv."],
    "github-pages": ["no", "GitHub Pages kan bare vise filer, ikke rendre sider på en server."],
  },
  "fullstack/server": {
    hetzner: ["best", "Billigst for en server som må gå hele tiden, og i Europa. Du driver den selv (Coolify gjør det enklere)."],
    render: ["ok", "Enklest å sette opp, uten å drive en server selv. Dyrere enn Hetzner."],
    railway: ["ok", "Enkelt, med bruksbasert pris."],
    vercel: ["no", "Vercel kjører ikke en server som går hele tiden, og passer ikke til en egen database."],
    cloudflare: ["no", "Cloudflare kjører ikke et vanlig serverprosjekt uten omskriving."],
    netlify: ["no", "Netlify kjører ikke en server som går hele tiden."],
    "github-pages": ["no", "GitHub Pages kan bare vise filer."],
  },
};

const FALLBACK = TABLE["fullstack/server"]!;

export type Advice = { host: Host; fit: Fit; why: string };

/** The fit of one host for a project: the table first, then the two overrides. */
export function adviceFor(host: Host, profile: Profile): Advice {
  if (profile.functions && !host.functions) return { host, fit: "no", why: "Siden har serverfunksjoner som er skrevet for Vercel. Her måtte de skrives om først." };
  if (host.noCommerce && profile.commercial) return { host, fit: "no", why: "Siden ser ut til å selge noe, og gratis hosting hos GitHub er ikke tillatt for det." };
  if (host.id === "vercel" && profile.functions) return { host, fit: "best", why: "Det eneste stedet serverfunksjonene dine virker uten endringer." };
  const row = TABLE[`${profile.stack ?? "static"}/${profile.delivery ?? "files"}`] ?? FALLBACK;
  const [fit, why] = row[host.id] ?? ["overkill", "Passer ikke særlig godt til denne typen prosjekt."];
  return { host, fit, why: typeof why === "function" ? why(profile) : why };
}

const RANK: Record<Fit, number> = { best: 0, ok: 1, overkill: 2, no: 3 };

/** All hosts ranked for the project, with a sentence each. Best first, what does not fit last. */
export function rank(profile: Profile): Advice[] {
  return HOSTS.map((host) => adviceFor(host, profile)).sort((a, b) => RANK[a.fit] - RANK[b.fit]);
}

export type Estimate = { money: Money | null; label: string };

/** What the host costs per month for this project, from the numbers in the catalog. */
export function estimateCost(host: Host, profile: Profile): Estimate {
  const needsServer = profile.functions || (profile.delivery ?? "files") !== "files";
  const money = profile.commercial && host.cost.commercial ? host.cost.commercial : needsServer ? host.cost.server : host.cost.files;
  return { money, label: formatMoney(money) };
}

export function formatMoney(money: Money | null): string {
  if (!money) return "sjekk hos leverandøren";
  if (money.amount === 0) return "gratis";
  return `${money.currency === "EUR" ? "ca. " : ""}${money.amount} ${money.currency} i måneden`;
}

export const hostName = (id: HostId) => hostById(id).name;
