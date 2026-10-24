/**
 * The prompt helper. A good order to the builder needs the same things every time: what it is, for
 * whom, what the visitor should do, how it should feel, what is on the page, which functions it needs
 * and what must not be made up. This turns a few choices into that order, with plain code. An AI step
 * can sharpen the text afterwards (see /api/prompt/improve), but the choices stand on their own.
 */

import { cleanKnowledge } from "../knowledge.ts";

export type KindId = "landing" | "shop" | "portfolio" | "restaurant" | "company" | "club" | "blog" | "booking" | "app";
export type GoalId = "contact" | "buy" | "book" | "signup" | "call" | "visit" | "read" | "use";
export type MoodId = "warm" | "dark" | "light" | "playful" | "serious";
export type ImagesId = "stock" | "generate" | "none";
export type SectionKey =
  | "hero" | "features" | "about" | "testimonials" | "pricing" | "faq" | "contact" | "products" | "gallery" | "works" | "menu" | "hours" | "services" | "events" | "news" | "posts" | "shipping" | "bookingform" | "dashboard" | "table" | "settings";
export type FeatureKey = "contactForm" | "newsletter" | "payment" | "accounts" | "map" | "share" | "darkToggle";

export type PromptSpec = {
  kind: KindId;
  name: string;
  about: string;
  audience: string;
  goal: GoalId;
  mood: MoodId;
  color: string;
  language: "nb" | "en";
  sections: SectionKey[];
  features: FeatureKey[];
  images: ImagesId;
  reference: string;
  extra: string;
};

export const KINDS: Record<KindId, { label: string; noun: string; sections: SectionKey[]; features: FeatureKey[]; goal: GoalId; mood: MoodId }> = {
  landing: { label: "Landingsside", noun: "en landingsside", sections: ["hero", "features", "about", "testimonials", "pricing", "faq", "contact"], features: ["contactForm", "newsletter"], goal: "contact", mood: "light" },
  shop: { label: "Nettbutikk", noun: "en liten nettbutikk", sections: ["hero", "products", "about", "testimonials", "shipping", "faq", "contact"], features: ["payment", "contactForm", "newsletter"], goal: "buy", mood: "warm" },
  portfolio: { label: "Portefølje", noun: "et porteføljenettsted", sections: ["hero", "works", "about", "services", "testimonials", "contact"], features: ["contactForm", "share"], goal: "contact", mood: "dark" },
  restaurant: { label: "Kafé eller restaurant", noun: "et nettsted for en kafé eller restaurant", sections: ["hero", "menu", "about", "gallery", "hours", "contact"], features: ["map", "contactForm", "newsletter"], goal: "visit", mood: "warm" },
  company: { label: "Tjeneste eller firma", noun: "et nettsted for en tjenestevirksomhet", sections: ["hero", "services", "about", "testimonials", "faq", "contact"], features: ["contactForm", "map"], goal: "contact", mood: "serious" },
  club: { label: "Forening eller lag", noun: "et nettsted for en forening", sections: ["hero", "about", "events", "news", "contact"], features: ["newsletter", "contactForm", "share"], goal: "signup", mood: "playful" },
  blog: { label: "Blogg eller magasin", noun: "en blogg", sections: ["hero", "posts", "about"], features: ["newsletter", "share"], goal: "read", mood: "warm" },
  booking: { label: "Timebestilling", noun: "et nettsted med timebestilling", sections: ["hero", "services", "bookingform", "hours", "testimonials", "contact"], features: ["contactForm", "map"], goal: "book", mood: "light" },
  app: { label: "App eller verktøy", noun: "en liten nettapp", sections: ["dashboard", "table", "settings"], features: ["accounts"], goal: "use", mood: "dark" },
};

export const GOALS: Record<GoalId, { label: string; text: string }> = {
  contact: { label: "Ta kontakt", text: "ta kontakt (skjema eller e-post)" },
  buy: { label: "Kjøpe", text: "legge noe i handlekurven og kjøpe" },
  book: { label: "Bestille time", text: "bestille en time eller et bord" },
  signup: { label: "Melde seg på", text: "melde seg på eller bli medlem" },
  call: { label: "Ringe", text: "ringe, med telefonnummeret godt synlig og klikkbart" },
  visit: { label: "Komme innom", text: "finne åpningstider og adresse og komme innom" },
  read: { label: "Lese og abonnere", text: "lese og abonnere på nyhetsbrevet" },
  use: { label: "Bruke verktøyet", text: "bruke verktøyet med en gang, uten omveier" },
};

export const MOODS: Record<MoodId, { label: string; text: string }> = {
  warm: { label: "Varm og redaksjonell", text: "Varm og redaksjonell: papirhvit bakgrunn, stor serif til overskriftene (gjerne med ett kursivt ord), jordnære toner og rolige bilder." },
  dark: { label: "Mørk og moderne", text: "Mørk og dyp: nesten svart bakgrunn med en tone av aksentfargen (ikke ren svart), myke gløder bak innholdet, glassaktige kort med hårfine kanter og tynn, ren typografi." },
  light: { label: "Lys og luftig", text: "Lys og luftig: mye luft, ren sans-serif, få farger, tydelig hierarki og rolige flater." },
  playful: { label: "Leken og fargerik", text: "Leken og energisk: tydelige former, god avrunding, to til tre farger fra paletten og små, tilbakeholdne animasjoner. Fortsatt lesbart og ryddig." },
  serious: { label: "Seriøs og tillitsvekkende", text: "Seriøs og tillitsvekkende: dempede farger, tydelig struktur, kompakt typografi og konkrete tall og referanser fremfor store ord." },
};

export const SECTIONS: Record<SectionKey, { label: string; text: string }> = {
  hero: { label: "Toppseksjon", text: "Toppseksjon med en tydelig overskrift, en kort ingress og en primærknapp mot målet" },
  features: { label: "Fordeler", text: "Tre til fire fordeler med ikon, kort tittel og én setning" },
  about: { label: "Om oss", text: "Om oss: historien og menneskene bak, med bilde" },
  testimonials: { label: "Omtaler", text: "Omtaler fra kunder, med navn og rolle (markert som eksempler til de byttes ut)" },
  pricing: { label: "Priser", text: "Prisoversikt med de planene eller pakkene som er aktuelle, og én anbefalt" },
  faq: { label: "Spørsmål og svar", text: "Ofte stilte spørsmål som en ryddig trekkspillliste" },
  contact: { label: "Kontakt", text: "Kontaktseksjon med e-post, telefon og adresse" },
  products: { label: "Produkter", text: "Produktrutenett med bilde, navn, pris og en kjøpsknapp, og enkle filtre" },
  gallery: { label: "Galleri", text: "Bildegalleri i et luftig rutenett" },
  works: { label: "Utvalgte arbeider", text: "Utvalgte arbeider som store kort med bilde, tittel og kort beskrivelse" },
  menu: { label: "Meny", text: "Meny delt i kategorier (faner), med pris per rett eller drikke" },
  hours: { label: "Åpningstider og adresse", text: "Åpningstider med dagens dag uthevet, og adresse" },
  services: { label: "Tjenester", text: "Tjenester som kort med navn, kort beskrivelse og eventuell pris" },
  events: { label: "Arrangementer", text: "Kommende arrangementer med dato, sted og påmelding" },
  news: { label: "Nyheter", text: "Siste nytt som korte kort med dato" },
  posts: { label: "Siste innlegg", text: "Siste innlegg som kort med bilde, tittel, dato og ingress, og kategorier" },
  shipping: { label: "Frakt og retur", text: "Frakt, levering og retur forklart kort og tydelig" },
  bookingform: { label: "Bestillingsskjema", text: "Bestillingsskjema med valg av tjeneste, dato og tid, og kontaktinfo" },
  dashboard: { label: "Nøkkeltall og grafer", text: "Oversikt med nøkkeltall øverst og tydelige grafer" },
  table: { label: "Liste eller tabell", text: "Liste eller tabell med søk, filter og sortering" },
  settings: { label: "Innstillinger", text: "Innstillinger for konto og visning" },
};

export const FEATURES: Record<FeatureKey, { label: string; text: string }> = {
  contactForm: { label: "Kontaktskjema", text: "Kontaktskjema (navn, e-post og melding) med tydelige tilstander for sender, sendt og feil. Selve sendingen kobles til senere under Koblinger, så ikke skriv inn noen nøkler" },
  newsletter: { label: "Nyhetsbrev", text: "Påmelding til nyhetsbrev (ett e-postfelt). Kobles til senere under Koblinger" },
  payment: { label: "Betaling", text: "Kjøpsknapper som peker til en betalingslenke eller kassen. Ingen nøkler i koden" },
  accounts: { label: "Innlogging og database", text: "Innlogging og lagring av data per bruker (brukerne ser bare sine egne data). Kobles til under Koblinger med Supabase, så beskriv gjerne hvilke data som skal lagres" },
  map: { label: "Kart og adresse", text: "Kart eller tydelig adresse med veibeskrivelse" },
  share: { label: "Delingsknapper", text: "Delingsknapper for sosiale medier og kopiering av lenke" },
  darkToggle: { label: "Mørk modus", text: "Bryter mellom lys og mørk visning" },
};

export const LIMITS = { name: 80, about: 600, audience: 200, extra: 800, reference: 300, prompt: 4_000 };

const clean = (value: string, max: number) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
    .trim();

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function defaultsFor(kind: KindId): PromptSpec {
  const k = KINDS[kind];
  return { kind, name: "", about: "", audience: "", goal: k.goal, mood: k.mood, color: "", language: "nb", sections: [...k.sections], features: [...k.features], images: "stock", reference: "", extra: "" };
}

/** A reference address, or an empty text when it is not an http(s) address. */
export function referenceUrl(input: string): string {
  const text = input.trim().slice(0, LIMITS.reference);
  if (!text) return "";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

/** The order to the builder, written out. Unknown choices are ignored, and nothing is added that was not chosen or needed. */
export function buildPrompt(input: PromptSpec): string {
  const spec = { ...defaultsFor(input.kind in KINDS ? input.kind : "landing"), ...input };
  const kind = KINDS[spec.kind] ?? KINDS.landing;
  const name = clean(spec.name, LIMITS.name);
  const about = clean(spec.about, LIMITS.about);
  const audience = clean(spec.audience, LIMITS.audience);
  const extra = clean(spec.extra, LIMITS.extra);
  const color = HEX.test(spec.color.trim()) ? spec.color.trim().toLowerCase() : "";
  const reference = referenceUrl(spec.reference);
  const sections = spec.sections.filter((key, i, all) => key in SECTIONS && all.indexOf(key) === i);
  const features = spec.features.filter((key, i, all) => key in FEATURES && all.indexOf(key) === i);
  const english = spec.language === "en";

  const blocks: string[] = [];
  blocks.push(`Bygg ${kind.noun}${name ? `, «${name}»` : ""}.${about ? ` ${about}` : ""}`);

  const who = [audience ? `Målgruppe: ${audience}.` : "", `Det viktigste en besøkende skal kunne gjøre: ${(GOALS[spec.goal] ?? GOALS.contact).text}. Alt på siden skal føre mot det, og primærknappen skal gjenta det samme valget hele veien.`].filter(Boolean);
  blocks.push(who.join("\n"));

  if (sections.length) blocks.push(`Sider og seksjoner, i denne rekkefølgen:\n${list(sections.map((key) => SECTIONS[key].text))}`);
  if (features.length) blocks.push(`Funksjoner:\n${list(features.map((key) => FEATURES[key].text))}`);

  const look = [(MOODS[spec.mood] ?? MOODS.light).text, color ? `Aksentfargen er ${color}. Bruk den sparsomt (knapper, understreking, utvalgte ord), og hold resten nøytralt.` : "Velg selv én aksentfarge som passer stemningen, og bruk den sparsomt."];
  blocks.push(`Design:\n${list(look)}\n- Velg ett skriftpar som passer, og hold deg til to skrifter.\n- Sterkt hierarki mellom overskrift, ingress og brødtekst, og god plass rundt innholdet.`);

  const pictures =
    spec.images === "none"
      ? "Ikke bruk bilder. Bruk typografi, flater og enkle ikoner."
      : spec.images === "generate"
        ? "Lag egne bilder til toppseksjonen og eventuelt ett emblem med bildeverktøyet, og bruk søk etter gratis bilder til resten. Ikke lag flere bilder enn nødvendig."
        : "Bruk gratis bilder fra bildesøket, tilpasset temaet. Alle bilder får alt-tekst.";
  blocks.push(`Bilder: ${pictures}`);

  if (reference) blocks.push(`Referanse: mål ${reference} med analyseverktøyet før du skriver kode, og følg stilen (skrifter, farger, rytme). Ikke kopier tekst, logo eller bilder derfra.`);

  blocks.push(
    `Språk og innhold: Skriv all tekst i selve siden på ${english ? "engelsk" : "norsk"}. Skriv konkret tekst med personlighet i stedet for fylltekst. Der du mangler fakta (priser, adresse, telefon, e-post, navn på personer, tall), skriv en tydelig plassholder i hakeparentes, for eksempel [telefonnummer], og ikke finn på noe.`,
  );
  blocks.push(`Krav: Siden skal fungere fra 360 px og opp, ha god kontrast og tydelig fokus for tastatur, ha riktig overskriftsstruktur med én h1, og lage brand.json, favicon og logo, så den er klar til å publiseres med SEO og delingsbilde.`);
  if (extra) blocks.push(`Egne ønsker:\n${extra}`);

  return blocks.join("\n\n").slice(0, LIMITS.prompt);
}

const TONES: Record<MoodId, string> = {
  warm: "Tonen er varm og personlig, med korte setninger og små detaljer som gjør teksten levende.",
  dark: "Tonen er rolig, moderne og selvsikker. Korte, presise setninger uten overdrivelser.",
  light: "Tonen er enkel og vennlig. Korte setninger, ingen floskler.",
  playful: "Tonen er leken og uformell. Bruk «du», gjerne litt humor, men hold teksten ryddig.",
  serious: "Tonen er saklig og tillitsvekkende. Unngå utropstegn, slang og store løfter.",
};

/**
 * The part of the choices that should hold for the whole project, not just the first message: language,
 * tone, who the business is and who it is for, and the accent colour. Written as the owner's standing
 * instructions (see lib/knowledge.ts). Returns an empty text when nothing has been filled in.
 */
export function knowledgeFromSpec(input: PromptSpec): string {
  const name = clean(input.name, LIMITS.name);
  const about = clean(input.about, LIMITS.about);
  const audience = clean(input.audience, LIMITS.audience);
  const color = HEX.test(input.color.trim()) ? input.color.trim().toLowerCase() : "";
  if (!name && !about && !audience && !color) return "";
  const lines: string[] = [];
  if (name) lines.push(`Virksomheten eller siden heter «${name}».`);
  if (about) lines.push(about);
  if (audience) lines.push(`Målgruppen er: ${audience}.`);
  lines.push(input.language === "en" ? "Write all text in the app in English." : "Skriv all tekst i appen og alle svar på norsk (bokmål).");
  lines.push((TONES[input.mood] ?? TONES.light));
  if (color) lines.push(`Aksentfargen er ${color}. Bruk den sparsomt, og ikke innfør flere aksentfarger uten at jeg ber om det.`);
  lines.push("Der fakta mangler (priser, adresse, telefon, navn, tall), bruk en tydelig plassholder i hakeparentes og ikke finn på noe.");
  return cleanKnowledge(lines.join("\n"));
}

/** What is still missing for a good order, in words the owner can act on. Nothing here blocks sending. */
export function promptCheck(input: PromptSpec): { score: number; missing: string[] } {
  const missing: string[] = [];
  if (clean(input.name, LIMITS.name).length < 2) missing.push("Gi siden eller virksomheten et navn.");
  if (clean(input.about, LIMITS.about).length < 25) missing.push("Beskriv med en til to setninger hva dere gjør eller tilbyr. Det er det som gir best tekst.");
  if (clean(input.audience, LIMITS.audience).length < 4) missing.push("Si hvem siden er for.");
  if (input.sections.length < 2 && input.kind !== "app") missing.push("Velg minst to seksjoner.");
  if (input.color.trim() && !HEX.test(input.color.trim())) missing.push("Fargen må være en hex-kode som #b45309, eller la feltet stå tomt.");
  if (input.reference.trim() && !referenceUrl(input.reference)) missing.push("Referansen må være en adresse som starter med http eller https.");
  const score = Math.max(0, 100 - missing.length * 20);
  return { score, missing };
}

/**
 * Cleans what the AI step answers with: plain text only, no code fences or leading remarks, and no
 * longer than a prompt may be. Returns null when nothing usable is left.
 */
export function sanitizeImproved(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const out = clean(
    text
      .replace(/^```[a-z]*\n?|```$/gim, "")
      .replace(/^\s*(?:her er|dette er)[^\n]*:\s*\n/i, ""),
    LIMITS.prompt,
  );
  return out.length >= 40 ? out : null;
}
