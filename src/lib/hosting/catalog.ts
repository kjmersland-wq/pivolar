/**
 * Hosting services a published site can go to. Prices are written down as they were found and
 * come with the date and a source, because they change often: always check the provider's page.
 */

export type HostId = "vercel" | "cloudflare" | "netlify" | "github-pages" | "render" | "railway" | "hetzner";

export type Money = { amount: number; currency: "USD" | "EUR" };

/** What a month costs at the lowest plan that works. Null means it does not apply or has to be looked up with the provider. */
export type Cost = {
  /** A site that is only files. */
  files: Money | null;
  /** A site with server functions, server rendering or a process of its own. */
  server: Money | null;
  /** When the site takes payment and the free plan does not allow that. */
  commercial?: Money;
};

export type Host = {
  id: HostId;
  name: string;
  /** Short, plain description of what it is good for. */
  summary: string;
  /** What it costs, as found. Never a promise. */
  price: string;
  /** The same, as numbers the rules can use. */
  cost: Cost;
  /** Where the price comes from. */
  source: string;
  /** When the price was last looked up (ISO date). */
  checked: string;
  /** Can the site's server functions under /api run here as they are? Only Vercel today. */
  functions: boolean;
  /** Free hosting that bans commercial sites (shops, SaaS). */
  noCommerce?: boolean;
  /** How the connection works. `automatic` deploys for you, `button` opens the host's own deploy page with your repository, `guide` is steps you follow. */
  hookup: "automatic" | "button" | "guide";
  /** The steps after the code is on GitHub. */
  steps: string[];
};

const CHECKED = "2026-10-24";

export const HOSTS: Host[] = [
  {
    id: "vercel",
    name: "Vercel",
    summary: "Raskest oppsett. Pivolar bygger og publiserer for deg, og serverfunksjonene (kontaktskjema, påmelding, Google) virker.",
    price: "Hobby er gratis, men bare for ikke-kommersiell bruk. Pro er 20 USD per bruker i måneden og kreves for en side som tar betalt.",
    cost: { files: { amount: 0, currency: "USD" }, server: { amount: 0, currency: "USD" }, commercial: { amount: 20, currency: "USD" } },
    source: "https://vercel.com/docs/plans/hobby",
    checked: CHECKED,
    functions: true,
    hookup: "automatic",
    steps: ["Pivolar legger siden live på Vercel. Du trenger ikke gjøre noe mer."],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    summary: "Billigst for rene sider: forespørsler til filene på siden er gratis og ubegrensede. Raskt over hele verden.",
    price: "Gratis for filene på en ren side. Workers Paid er fra 5 USD i måneden hvis du senere legger til kode som kjører på serveren.",
    cost: { files: { amount: 0, currency: "USD" }, server: { amount: 5, currency: "USD" } },
    source: "https://developers.cloudflare.com/workers/static-assets/billing-and-limitations",
    checked: CHECKED,
    functions: false,
    hookup: "button",
    steps: ["Trykk «Åpne i Cloudflare» og logg inn.", "Velg repoet, la Cloudflare bygge det (byggekommando og mappe står i wrangler.jsonc), og trykk Deploy.", "Legg til eget domene under Workers & Pages → Settings → Domains."],
  },
  {
    id: "netlify",
    name: "Netlify",
    summary: "Enkelt for rene sider, med skjemaer og forhåndsvisninger. Oppsettet ligger i netlify.toml.",
    price: "Gratis plan med 300 kreditter i måneden. Personal 9 USD og Pro 20 USD per måned. Trafikk, forespørsler og publiseringer trekker kreditter.",
    cost: { files: { amount: 0, currency: "USD" }, server: { amount: 0, currency: "USD" } },
    source: "https://www.netlify.com/changelog/netlify-pricing-update-introducing-credit-based-plans/",
    checked: CHECKED,
    functions: false,
    hookup: "button",
    steps: ["Trykk «Åpne i Netlify» og logg inn.", "Velg repoet. Byggekommando og mappe hentes fra netlify.toml.", "Legg til eget domene under Domain management."],
  },
  {
    id: "github-pages",
    name: "GitHub Pages",
    summary: "Gratis og enkelt for portefølje, blogg og info-sider. Ikke for butikker.",
    price: "Gratis for offentlige repoer. Grenser: 1 GB side, 100 GB trafikk i måneden (myk grense). Ikke tillatt for nettbutikk eller SaaS.",
    cost: { files: { amount: 0, currency: "USD" }, server: null },
    source: "https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits",
    checked: CHECKED,
    functions: false,
    noCommerce: true,
    hookup: "guide",
    steps: ["Repoet må være offentlig (private repoer krever betalt GitHub-plan).", "Åpne Settings → Pages i repoet og velg «GitHub Actions» som kilde.", "Arbeidsflyten pages.yml bygger og publiserer siden. Adressen blir brukernavn.github.io/repo, så sett et eget domene under Pages hvis siden skal ligge på roten."],
  },
  {
    id: "render",
    name: "Render",
    summary: "For sider som trenger en egen server. Til en ren side er det mer enn nødvendig.",
    price: "Webtjeneste fra 7 USD i måneden (Starter, 512 MB) og 25 USD (Standard, 2 GB). Pris for statiske sider: sjekk hos Render.",
    cost: { files: null, server: { amount: 7, currency: "USD" } },
    source: "https://render.com/pricing",
    checked: CHECKED,
    functions: false,
    hookup: "button",
    steps: ["Trykk «Åpne i Render» og logg inn.", "Render leser render.yaml i repoet og lager en statisk side.", "Legg til eget domene under Settings → Custom Domains."],
  },
  {
    id: "railway",
    name: "Railway",
    summary: "Enkel server-hosting med bruksbasert pris. Finner selv ut hvordan prosjektet skal bygges, eller bruker Dockerfile hvis du har en.",
    price: "Hobby 5 USD i måneden, som også gjelder som kreditt mot det du bruker (CPU, minne, lagring og trafikk). Pro 20 USD.",
    cost: { files: { amount: 5, currency: "USD" }, server: { amount: 5, currency: "USD" } },
    source: "https://docs.railway.com/pricing/plans",
    checked: CHECKED,
    functions: false,
    hookup: "guide",
    steps: ["Åpne railway.com/new og velg «Deploy from GitHub repo».", "Velg repoet. Railway bruker Dockerfile hvis den finnes, ellers bygger den selv.", "Legg inn miljøvariabler under Variables, og lag et domene under Settings → Networking."],
  },
  {
    id: "hetzner",
    name: "Hetzner (egen server)",
    summary: "Full kontroll og fast pris, servere i Europa. Du driver serveren selv: oppdateringer, sikkerhetskopier og https.",
    price: "Små servere fra ca. 5,5 EUR i måneden pluss 0,50 EUR for IPv4, uten mva. Prisene steg to ganger i 2026, og kildene er uenige om detaljene.",
    cost: { files: { amount: 6, currency: "EUR" }, server: { amount: 6, currency: "EUR" } },
    source: "https://docs.hetzner.cloud/whats-new",
    checked: CHECKED,
    functions: false,
    hookup: "guide",
    steps: ["Lag en server (Ubuntu) og sett opp Docker.", "Kopier repoet dit (git clone) og kjør «docker compose up -d --build» (se HOSTING.md i repoet).", "Pek domenet mot serverens IP-adresse. Caddy ordner https."],
  },
];

export const HOST_IDS = HOSTS.map((h) => h.id);
export const isHostId = (value: unknown): value is HostId => typeof value === "string" && (HOST_IDS as string[]).includes(value);
export const hostById = (id: HostId) => HOSTS.find((h) => h.id === id)!;
