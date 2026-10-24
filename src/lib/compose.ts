// Assembles a landing page from ready-made sections, a color palette and the owner's own words.
// Every file is plain TSX with literal Tailwind classes, so the direct element editor can change
// text and colors afterwards. No AI is involved.

import { makePalette, type Palette } from "./palette.ts";

export type SectionId = "hero" | "features" | "about" | "pricing" | "testimonials" | "faq" | "cta" | "newsletter" | "contact" | "share";

export type Spec = {
  name: string;
  tagline: string;
  description: string;
  email: string;
  color: string;
  dark: boolean;
  heroStyle: "centered" | "split";
  /** Sections between the navbar and the footer, in order. */
  sections: SectionId[];
};

export const SECTION_INFO: Record<SectionId, { label: string; file: string; anchor: string; nav: string }> = {
  hero: { label: "Hero", file: "Hero", anchor: "", nav: "" },
  features: { label: "Fordeler", file: "Features", anchor: "fordeler", nav: "Fordeler" },
  about: { label: "Om oss", file: "About", anchor: "om-oss", nav: "Om oss" },
  pricing: { label: "Priser", file: "Pricing", anchor: "priser", nav: "Priser" },
  testimonials: { label: "Omtaler", file: "Testimonials", anchor: "omtaler", nav: "Omtaler" },
  faq: { label: "Spørsmål", file: "Faq", anchor: "sporsmal", nav: "Spørsmål" },
  cta: { label: "Oppfordring", file: "Cta", anchor: "", nav: "" },
  newsletter: { label: "Nyhetsbrev", file: "Newsletter", anchor: "nyhetsbrev", nav: "" },
  contact: { label: "Kontakt", file: "Contact", anchor: "kontakt", nav: "Kontakt" },
  share: { label: "Del siden", file: "Share", anchor: "", nav: "" },
};

export const DEFAULT_SECTIONS: SectionId[] = ["hero", "features", "about", "testimonials", "pricing", "faq", "cta", "newsletter", "contact", "share"];

export const DEFAULT_SPEC: Spec = {
  name: "",
  tagline: "",
  description: "",
  email: "",
  color: "#6366f1",
  dark: false,
  heroStyle: "centered",
  sections: DEFAULT_SECTIONS,
};

/** Text that is safe between JSX tags: braces and angle brackets become a string expression. */
const txt = (value: string) => {
  const clean = value.replace(/\s+/g, " ").trim();
  return /[{}<>]/.test(clean) ? `{${JSON.stringify(clean)}}` : clean;
};
const str = (value: string) => JSON.stringify(value.replace(/\s+/g, " ").trim());

type Ctx = { spec: Spec; p: Palette; name: string; tagline: string; description: string; email: string };

const WRAP = "mx-auto w-full max-w-6xl px-6";

function navbar(c: Ctx, links: { label: string; anchor: string }[]) {
  const { p } = c;
  return `export default function Navbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-[${p.border}] bg-[${p.bg}]/85 backdrop-blur">
      <div className="${WRAP} flex h-16 items-center justify-between">
        <a href="#" className="text-lg font-semibold tracking-tight text-[${p.text}]">${txt(c.name)}</a>
        <nav className="hidden items-center gap-7 md:flex">
${links.map((l) => `          <a href="#${l.anchor}" className="text-sm text-[${p.muted}] transition hover:text-[${p.text}]">${txt(l.label)}</a>`).join("\n")}
        </nav>
        <a href="#kontakt" className="rounded-full bg-[${p.brand}] px-4 py-2 text-sm font-medium text-[${p.onBrand}] transition hover:bg-[${p.brandStrong}]">Ta kontakt</a>
      </div>
    </header>
  );
}
`;
}

function hero(c: Ctx) {
  const { p, spec } = c;
  const badge = `<span className="inline-flex items-center gap-1.5 rounded-full bg-[${p.brandSoft}] px-3 py-1 text-xs font-medium text-[${p.link}]">
            <Sparkles size={14} />
            Velkommen
          </span>`;
  const actions = `<div className="mt-8 flex flex-wrap items-center gap-3${spec.heroStyle === "centered" ? " justify-center" : ""}">
            <a href="#kontakt" className="inline-flex items-center gap-2 rounded-full bg-[${p.brand}] px-6 py-3 text-sm font-medium text-[${p.onBrand}] shadow-lg transition hover:bg-[${p.brandStrong}]">
              Kom i gang
              <ArrowRight size={16} />
            </a>
            <a href="#fordeler" className="rounded-full border border-[${p.border}] bg-[${p.surface}] px-6 py-3 text-sm font-medium text-[${p.text}] transition hover:border-[${p.brand}]">Les mer</a>
          </div>`;
  if (spec.heroStyle === "split") {
    return `import { ArrowRight, Sparkles } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-[${p.bg}]">
      <div className="${WRAP} grid items-center gap-12 py-20 md:grid-cols-2 md:py-28">
        <div>
          ${badge}
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-[${p.text}] md:text-6xl">${txt(c.tagline)}</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[${p.muted}]">${txt(c.description)}</p>
          ${actions}
        </div>
        <div className="relative aspect-[4/3] rounded-3xl bg-gradient-to-br from-[${p.brand}] to-[${p.accent}] shadow-2xl">
          <div className="absolute inset-6 rounded-2xl border border-white/30 bg-white/10 backdrop-blur-sm" />
        </div>
      </div>
    </section>
  );
}
`;
  }
  return `import { ArrowRight, Sparkles } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-[${p.bg}]">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[56rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-[${p.brand}] to-[${p.accent}] opacity-20 blur-3xl" />
      <div className="${WRAP} relative py-24 text-center md:py-36">
        ${badge}
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-[${p.text}] md:text-6xl">${txt(c.tagline)}</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[${p.muted}]">${txt(c.description)}</p>
        ${actions}
      </div>
    </section>
  );
}
`;
}

const heading = (p: Palette, eyebrow: string, title: string, center = true) => `<div className="${center ? "mx-auto text-center " : ""}max-w-2xl">
          <p className="text-sm font-medium text-[${p.link}]">${eyebrow}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[${p.text}] md:text-4xl">${title}</h2>
        </div>`;

function features(c: Ctx) {
  const { p } = c;
  const items = [
    ["Sparkles", "Enkelt å komme i gang", "Vi tar oss av det vanskelige, så du slipper å bruke tid på detaljene."],
    ["Zap", "Raskt og pålitelig", "Du får svar og resultater når du trenger dem, uten venting."],
    ["ShieldCheck", "Trygt og ryddig", "Tydelige rammer og åpenhet i alt vi gjør, hele veien."],
  ] as const;
  return `import { ShieldCheck, Sparkles, Zap } from "lucide-react";

export default function Features() {
  return (
    <section id="fordeler" className="bg-[${p.bg}] py-20 md:py-28">
      <div className="${WRAP}">
        ${heading(p, "Fordeler", "Derfor velger folk oss")}
        <div className="mt-14 grid gap-6 md:grid-cols-3">
${items
  .map(
    ([icon, title, body]) => `          <div className="rounded-2xl border border-[${p.border}] bg-[${p.surface}] p-7">
            <span className="grid size-11 place-items-center rounded-xl bg-[${p.brandSoft}] text-[${p.link}]">
              <${icon} size={22} />
            </span>
            <h3 className="mt-5 text-lg font-semibold text-[${p.text}]">${title}</h3>
            <p className="mt-2 leading-relaxed text-[${p.muted}]">${body}</p>
          </div>`,
  )
  .join("\n")}
        </div>
      </div>
    </section>
  );
}
`;
}

function about(c: Ctx) {
  const { p } = c;
  return `export default function About() {
  return (
    <section id="om-oss" className="bg-[${p.surface}] py-20 md:py-28">
      <div className="${WRAP} grid items-center gap-12 md:grid-cols-2">
        <div className="aspect-square rounded-3xl bg-gradient-to-tr from-[${p.accent}] to-[${p.brand}] opacity-90" />
        <div>
          <p className="text-sm font-medium text-[${p.link}]">Om oss</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[${p.text}] md:text-4xl">Hei, vi er ${txt(c.name)}</h2>
          <p className="mt-5 text-lg leading-relaxed text-[${p.muted}]">${txt(c.description)}</p>
          <p className="mt-4 leading-relaxed text-[${p.muted}]">Vi bryr oss om å gjøre det enkelt for deg. Ta gjerne kontakt, så finner vi en løsning som passer.</p>
        </div>
      </div>
    </section>
  );
}
`;
}

function pricing(c: Ctx) {
  const { p } = c;
  const tiers = [
    ["Liten", "490 kr", "Passer for å komme i gang", ["Det viktigste", "Støtte på e-post"], false],
    ["Vanlig", "990 kr", "Det de fleste velger", ["Alt i Liten", "Rask oppfølging", "Månedlig gjennomgang"], true],
    ["Stor", "1 990 kr", "For deg som vil mer", ["Alt i Vanlig", "Egen kontaktperson", "Tilpassede løsninger"], false],
  ] as const;
  return `import { Check } from "lucide-react";

export default function Pricing() {
  return (
    <section id="priser" className="bg-[${p.bg}] py-20 md:py-28">
      <div className="${WRAP}">
        ${heading(p, "Priser", "Enkle og ærlige priser")}
        <div className="mt-14 grid gap-6 md:grid-cols-3">
${tiers
  .map(
    ([name, price, note, list, featured]) => `          <div className="rounded-2xl border p-7 ${
      featured ? `border-[${p.brand}] bg-[${p.surface}] shadow-xl md:-translate-y-2` : `border-[${p.border}] bg-[${p.surface}]`
    }">
            <h3 className="text-lg font-semibold text-[${p.text}]">${name}</h3>
            <p className="mt-1 text-sm text-[${p.muted}]">${note}</p>
            <p className="mt-6 text-4xl font-semibold tracking-tight text-[${p.text}]">${price}</p>
            <ul className="mt-6 space-y-3">
${list
  .map(
    (item) => `              <li className="flex items-center gap-2.5 text-[${p.muted}]">
                <Check size={16} className="shrink-0 text-[${p.link}]" />
                ${item}
              </li>`,
  )
  .join("\n")}
            </ul>
            <a href="#kontakt" className="mt-8 block rounded-full ${
              featured ? `bg-[${p.brand}] text-[${p.onBrand}] hover:bg-[${p.brandStrong}]` : `border border-[${p.border}] text-[${p.text}] hover:border-[${p.brand}]`
            } px-5 py-2.5 text-center text-sm font-medium transition">Velg ${name.toLowerCase()}</a>
          </div>`,
  )
  .join("\n")}
        </div>
      </div>
    </section>
  );
}
`;
}

function testimonials(c: Ctx) {
  const { p } = c;
  const items = [
    ["Ingrid", "Kunde", "Veldig fornøyd. Alt var enkelt fra første stund, og vi fikk raskt svar."],
    ["Jonas", "Kunde", "Ryddig, hyggelig og pålitelig. Anbefales på det varmeste."],
    ["Mari", "Kunde", "Akkurat det vi trengte. Vi kommer gjerne tilbake."],
  ] as const;
  return `export default function Testimonials() {
  return (
    <section id="omtaler" className="bg-[${p.surface}] py-20 md:py-28">
      <div className="${WRAP}">
        ${heading(p, "Omtaler", "Det sier kundene våre")}
        <div className="mt-14 grid gap-6 md:grid-cols-3">
${items
  .map(
    ([who, role, quote]) => `          <figure className="rounded-2xl border border-[${p.border}] bg-[${p.bg}] p-7">
            <blockquote className="leading-relaxed text-[${p.text}]">${quote}</blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-[${p.brandSoft}] text-sm font-semibold text-[${p.link}]">${who[0]}</span>
              <span>
                <span className="block text-sm font-medium text-[${p.text}]">${who}</span>
                <span className="block text-xs text-[${p.muted}]">${role}</span>
              </span>
            </figcaption>
          </figure>`,
  )
  .join("\n")}
        </div>
      </div>
    </section>
  );
}
`;
}

function faq(c: Ctx) {
  const { p } = c;
  const items = [
    ["Hvordan kommer jeg i gang?", "Ta kontakt med oss, så avtaler vi en uforpliktende prat om hva du trenger."],
    ["Hva koster det?", "Prisene står oppført over. Trenger du noe annet, lager vi et tilbud som passer."],
    ["Hvor raskt får jeg svar?", "Vi svarer vanligvis innen én virkedag."],
  ] as const;
  return `export default function Faq() {
  return (
    <section id="sporsmal" className="bg-[${p.bg}] py-20 md:py-28">
      <div className="mx-auto w-full max-w-3xl px-6">
        ${heading(p, "Spørsmål", "Ofte stilte spørsmål")}
        <div className="mt-12 space-y-3">
${items
  .map(
    ([q, a]) => `          <details className="group rounded-2xl border border-[${p.border}] bg-[${p.surface}] p-5">
            <summary className="cursor-pointer list-none font-medium text-[${p.text}]">${q}</summary>
            <p className="mt-3 leading-relaxed text-[${p.muted}]">${a}</p>
          </details>`,
  )
  .join("\n")}
        </div>
      </div>
    </section>
  );
}
`;
}

function cta(c: Ctx) {
  const { p } = c;
  return `export default function Cta() {
  return (
    <section className="bg-[${p.bg}] py-16 md:py-24">
      <div className="${WRAP}">
        <div className="rounded-3xl bg-gradient-to-br from-[${p.brand}] to-[${p.accent}] px-8 py-16 text-center text-[${p.onBrand}] md:px-16">
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">Klar for å komme i gang?</h2>
          <p className="mx-auto mt-4 max-w-xl opacity-90">Send oss en melding, så tar vi det derfra.</p>
          <a href="#kontakt" className="mt-8 inline-block rounded-full bg-white px-7 py-3 text-sm font-medium text-[#0b0b0f] transition hover:opacity-90">Ta kontakt</a>
        </div>
      </div>
    </section>
  );
}
`;
}

function contact(c: Ctx) {
  const { p } = c;
  const mail = c.email ? c.email : "";
  return `import { Mail } from "lucide-react";

export default function Contact() {
  return (
    <section id="kontakt" className="bg-[${p.surface}] py-20 md:py-28">
      <div className="mx-auto w-full max-w-2xl px-6 text-center">
        <p className="text-sm font-medium text-[${p.link}]">Kontakt</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[${p.text}] md:text-4xl">Si hei</h2>
        <p className="mt-4 text-[${p.muted}]">Vi svarer så fort vi kan.</p>
${
  mail
    ? `        <a href={${str(`mailto:${mail}`)}} className="mt-8 inline-flex items-center gap-2 rounded-full bg-[${p.brand}] px-7 py-3 text-sm font-medium text-[${p.onBrand}] transition hover:bg-[${p.brandStrong}]">
          <Mail size={16} />
          ${txt(mail)}
        </a>`
    : `        <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-[${p.border}] px-6 py-3 text-sm text-[${p.muted}]">
          <Mail size={16} />
          Legg inn e-postadressen din her
        </p>`
}
      </div>
    </section>
  );
}
`;
}

/** Newsletter sign-up. It posts to /api/subscribe, the function the Resend connector adds, and says so in the preview where it does not exist. */
function newsletter(c: Ctx) {
  const { p } = c;
  return `import { useState, type FormEvent } from "react";
import { Mail } from "lucide-react";

export default function Newsletter() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    try {
      const response = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, website }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Påmeldingen virker først etter at siden er publisert og Resend er koblet til.");
      setState("ok");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Noe gikk galt. Prøv igjen.");
      setState("error");
    }
  }

  return (
    <section id="nyhetsbrev" className="bg-[${p.bg}] py-16 md:py-20">
      <div className="mx-auto w-full max-w-2xl px-6 text-center">
        <Mail className="mx-auto text-[${p.link}]" size={28} />
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[${p.text}] md:text-3xl">Hold deg oppdatert</h2>
        <p className="mt-3 text-[${p.muted}]">Få nyheter og tilbud rett i innboksen. Du kan melde deg av når som helst.</p>
        {state === "ok" ? (
          <p role="status" className="mt-6 rounded-xl bg-[${p.brandSoft}] px-5 py-3 text-sm font-medium text-[${p.link}]">Takk! Du er på listen.</p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="nyhetsbrev-epost">E-postadresse</label>
            <input id="nyhetsbrev-epost" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="din@epost.no" className="min-w-0 flex-1 rounded-full border border-[${p.border}] bg-[${p.surface}] px-5 py-3 text-sm text-[${p.text}] outline-none focus:border-[${p.brand}]" />
            <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
            <button type="submit" disabled={state === "sending"} className="rounded-full bg-[${p.brand}] px-7 py-3 text-sm font-medium text-[${p.onBrand}] transition hover:bg-[${p.brandStrong}] disabled:opacity-60">
              {state === "sending" ? "Melder på …" : "Meld meg på"}
            </button>
          </form>
        )}
        {state === "error" ? <p role="alert" className="mt-3 text-sm text-red-500">{message}</p> : null}
      </div>
    </section>
  );
}
`;
}

/** A row of share buttons for the social networks. They open each network's own share page with the address of this page. */
function share(c: Ctx) {
  const { p } = c;
  return `import { useState } from "react";
import { Link2, Share2 } from "lucide-react";

const NETWORKS = [
  { name: "Facebook", href: (url: string) => "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(url) },
  { name: "X", href: (url: string, text: string) => "https://twitter.com/intent/tweet?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text) },
  { name: "LinkedIn", href: (url: string) => "https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(url) },
  { name: "WhatsApp", href: (url: string, text: string) => "https://wa.me/?text=" + encodeURIComponent(text + " " + url) },
  { name: "E-post", href: (url: string, text: string) => "mailto:?subject=" + encodeURIComponent(text) + "&body=" + encodeURIComponent(url) },
];

export default function Share() {
  const [copied, setCopied] = useState(false);
  const text = ${str(c.name)};
  const address = () => (typeof window === "undefined" ? "" : window.location.href.split("#")[0] ?? "");

  function open(href: string) {
    if (href.startsWith("mailto:")) window.location.href = href;
    else window.open(href, "_blank", "noopener,noreferrer,width=640,height=560");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The browser did not allow it: the address stays in the address bar.
    }
  }

  const button = "inline-flex items-center gap-2 rounded-full border border-[${p.border}] bg-[${p.surface}] px-4 py-2 text-sm text-[${p.text}] transition hover:border-[${p.brand}]";
  return (
    <section className="bg-[${p.bg}] py-10">
      <div className="${WRAP} flex flex-wrap items-center justify-center gap-3">
        <span className="inline-flex items-center gap-2 text-sm text-[${p.muted}]">
          <Share2 size={16} />
          Del siden
        </span>
        {NETWORKS.map((network) => (
          <button key={network.name} type="button" className={button} onClick={() => open(network.href(address(), text))} aria-label={"Del på " + network.name}>
            {network.name}
          </button>
        ))}
        <button type="button" className={button} onClick={() => void copy()}>
          <Link2 size={14} />
          {copied ? "Kopiert" : "Kopier lenke"}
        </button>
      </div>
    </section>
  );
}
`;
}

function footer(c: Ctx) {
  const { p } = c;
  return `export default function Footer() {
  return (
    <footer className="border-t border-[${p.border}] bg-[${p.bg}] py-10">
      <div className="${WRAP} flex flex-col items-center justify-between gap-3 text-sm text-[${p.muted}] md:flex-row">
        <span>© ${new Date().getFullYear()} ${txt(c.name)}</span>
        <span>Alle rettigheter reservert</span>
      </div>
    </footer>
  );
}
`;
}

/** Builds the files of a landing page. Throws nothing; empty fields get friendly defaults. */
export function composeSite(input: Spec): Record<string, string> {
  const spec: Spec = { ...input, name: input.name.trim() || "Mitt firma" };
  const p = makePalette(spec.color, spec.dark);
  const c: Ctx = {
    spec,
    p,
    name: spec.name,
    tagline: spec.tagline.trim() || `Velkommen til ${spec.name}`,
    description: spec.description.trim() || "Vi hjelper deg med det som er viktig for deg, enkelt og trygt.",
    email: spec.email.trim(),
  };
  const chosen = spec.sections.filter((id, i, all) => all.indexOf(id) === i && id in SECTION_INFO);
  const links = chosen.filter((id) => SECTION_INFO[id].nav).map((id) => ({ label: SECTION_INFO[id].nav, anchor: SECTION_INFO[id].anchor }));

  const builders: Record<SectionId, (ctx: Ctx) => string> = { hero, features, about, pricing, testimonials, faq, cta, newsletter, contact, share };
  const files: Record<string, string> = { "/components/Navbar.tsx": navbar(c, links), "/components/Footer.tsx": footer(c) };
  for (const id of chosen) files[`/components/${SECTION_INFO[id].file}.tsx`] = builders[id](c);

  const imports = ["Navbar", ...chosen.map((id) => SECTION_INFO[id].file), "Footer"];
  const body = imports.map((name) => `      <${name} />`).join("\n");
  files["/App.tsx"] = `${imports.map((name) => `import ${name} from "./components/${name}";`).join("\n")}

export default function App() {
  return (
    <div className="min-h-screen bg-[${p.bg}] text-[${p.text}] antialiased">
${body}
    </div>
  );
}
`;
  files["/styles.css"] = `html, body, #root { margin: 0; min-height: 100%; }
html { scroll-behavior: smooth; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; background: ${p.bg}; }
details > summary::-webkit-details-marker { display: none; }
`;
  return files;
}
