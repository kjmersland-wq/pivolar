import { convertToModelMessages, createUIMessageStreamResponse, generateImage, isStepCount, streamText, toUIMessageStream, type UIMessage } from "ai";
import { z } from "zod";
import { chatModel } from "@/lib/ai-model";
import { knowledgeSection } from "@/lib/knowledge";
import { uploadsSection } from "@/lib/uploads/rules";
import { createAnalyzeTool, trimOldAnalyses } from "@/lib/analyze/tool";
import { buildIndex, readFile, recentPaths, searchFiles, shouldIndex } from "@/lib/context";
import { detectLoop, withNoteBeforeFinish, type LoopFinding, type StepLike } from "@/lib/guard/loop";
import { createImageTool } from "@/lib/image-gen";
import { searchImages } from "@/lib/images";
import { quotaConfig } from "@/lib/quota/config";
import { CAP_NOTE, overCap, type StepUsage } from "@/lib/quota/decide";
import { openAiGate } from "@/lib/quota/gate";
import { createClient } from "@/lib/supabase/server";
import { logChatUsage, logImageUsage } from "@/lib/usage/log";
import { chatCostDetailed, pricesFor } from "@/lib/usage/pricing";
import { SANDBOX_DEPENDENCIES, TEMPLATE, applyTool, deriveFiles, visibleFiles, type FileMap, type UserEdit } from "@/lib/files";

export const maxDuration = 300;

/** Turns provider errors into something the user can act on, without leaking internals. */
function friendlyError(error: unknown): string {
  const text = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}` : String(error);
  if (/credit card|customer_verification_required/i.test(text)) {
    return "AI Gateway trenger et betalingskort på Vercel-kontoen din for å låse opp de gratis kredittene. Legg det inn under AI på vercel.com, og prøv igjen.";
  }
  if (/credit balance|billing/i.test(text)) return "Anthropic-kontoen mangler kreditt. Fyll på under Plans & Billing hos Anthropic.";
  if (/invalid x-api-key|authentication_error|api key/i.test(text)) return "Nøkkelen ble ikke godtatt. Sjekk ANTHROPIC_API_KEY (eller AI_GATEWAY_API_KEY) i .env.local.";
  if (/rate.?limit|429/i.test(text)) return "For mange forespørsler akkurat nå. Vent litt og prøv igjen.";
  if (/budget|insufficient|credits/i.test(text)) return "AI-kredittene er brukt opp. Fyll på under AI på vercel.com.";
  if (/auth|token|unauthor|401|oidc/i.test(text)) return "Fikk ikke tilgang til AI Gateway. Kjør «vercel env pull» på nytt, eller sett AI_GATEWAY_API_KEY.";
  return "Noe gikk galt hos AI-leverandøren. Prøv igjen om litt.";
}

const MODEL = chatModel;

function filesSection(files: FileMap, recent: string[]): string {
  const visible = visibleFiles(files);
  // Small projects are sent in full. Big ones get a map and the newest files, and the rest is read on demand.
  if (!shouldIndex(files)) {
    return `GJELDENDE FILER\n${Object.entries(visible).map(([path, content]) => `--- ${path}\n${content}`).join("\n\n")}`;
  }
  const index = buildIndex(files, recent);
  const bodies = index.inlined.map((path) => `--- ${path}\n${visible[path]}`).join("\n\n");
  return `PROSJEKTET ER STORT, så bare de nyeste filene står i fulltekst. Under er et kart over ALLE filene. Les en fil med readFile (nøyaktig tekst, bruk from/to for lange filer) FØR du endrer en fil du ikke ser i fulltekst, og bruk searchFiles for å finne hvor noe brukes. Ikke gjett på innholdet i filer du ikke har lest. Brukerens egne endringer ligger i filene.\n\nFILKART\n${index.map}\n\nFILER I FULLTEKST\n${bodies}`;
}

/** A project that came from GitHub or a ZIP has its own structure, so the starter-template rules do not apply. */
const isImportedProject = (files: FileMap) => "/package.json" in files;

const IMPORTED_PROJECT = `IMPORTERT PROSJEKT
- Dette er et eksisterende prosjekt som brukeren har hentet inn (for eksempel fra GitHub). Det har sin egen struktur, sine egne pakker og sin egen stil. Filene ligger på sine opprinnelige stier (for eksempel /src/App.tsx, /src/pages/Index.tsx, /package.json). Les filene før du endrer dem.
- IKKE bygg om prosjektet, ikke flytt filer, og ikke opprett /App.tsx eller /styles.css i roten (det er Pivolars egen startmal, ikke en del av prosjektet). Gjør bare den endringen brukeren ber om, på filene der den hører hjemme.
- Følg prosjektets egne valg: samme komponentbibliotek (for eksempel shadcn/ui i /src/components/ui), samme navnemønster, samme måte å hente data på og samme klasser. Gjenbruk det som finnes før du lager noe nytt.
- Du kan bruke pakker som allerede står i /package.json. Legg ikke til nye pakker uten å si det tydelig. Rør ikke /package.json, lockfiler, konfigurasjonsfiler eller .env-filer uten at brukeren ber om det.
- Forhåndsvisningen er en forenklet kjøring av koden i nettleseren. Den kan mangle miljøvariabler, backend og tema fra konfigurasjonsfilene, så en feil der betyr ikke alltid at koden er feil. Endringene sendes til GitHub som en pull request, og originalen røres ikke.`;

function systemPrompt(all: FileMap, mode: "build" | "chat", recent: string[]) {
  const imported = isImportedProject(all);
  // The starter template is always present in the sandbox, but it is not part of an imported project.
  const files = imported ? Object.fromEntries(Object.entries(all).filter(([path, content]) => TEMPLATE[path] !== content)) : all;
  const section = filesSection(files, recent);
  const projectSection = imported ? IMPORTED_PROJECT : `PROSJEKTET
- Det er en React + TypeScript-app som kjører i en nettleser-sandbox (Sandpack). Inngangen er /index.tsx (beskyttet, du kan ikke endre den) og den importerer ./App og ./styles.css. Bygg alt fra /App.tsx.
- Styling er Tailwind CSS (via CDN, alle vanlige klasser virker). Bruk /styles.css bare til det Tailwind ikke dekker.
- Tillatte pakker: react, react-dom, ${Object.keys(SANDBOX_DEPENDENCIES).join(", ")}. Ikke importer noe annet.
- Grafer og diagrammer: bruk recharts. Datoer: date-fns.
- Flere sider: bruk react-router-dom med HashRouter (ikke BrowserRouter, forhåndsvisningen har ingen server). Legg hver side i /pages/ og del layout (meny, bunn) i /components/. Bruk <Link> og NavLink, og scroll til toppen ved sidebytte.
- Ingen backend, ingen filsystem og ingen miljøvariabler. Lagre data i komponenttilstand eller localStorage.`;
  return `Du er Pivolar, en erfaren designer og frontend-utvikler som bygger små apper sammen med brukeren.
Brukeren skriver vanligvis norsk. Svar på samme språk som brukeren, kort og vennlig, og skriv teksten i selve appen på språket brukeren ber om.

BRUKERENS EGNE ENDRINGER OG BILDER
- Brukeren kan redigere kode selv. Filene under (se «GJELDENDE FILER» eller «FILKART») er alltid den nyeste versjonen, med brukerens endringer. Bygg videre på den, ikke på det du husker.
- Brukeren kan sende bilder (skjermbilder, skisser, design). Gjenskap det du ser så nøyaktig som mulig: layout, farger, typografi og stemning. Beskriv kort hva du tolket.
- Brukeren kan velge et element i forhåndsvisningen. Meldingen har da en blokk <valgt-element> med tag, tekst, klasser og komponentnavn. Finn elementet i koden (søk etter teksten og klassene) og gjør kun endringen brukeren ber om. Ikke endre andre tekster, e-postadresser, priser eller stil som ikke er nevnt. Gjelder ønsket tydelig hele nettstedet (for eksempel et navn), endre det samme overalt, men si fra om det.

${projectSection}

REFERANSE-SIDER (kopi eller samme stil)
- Vil brukeren lage noe i samme stil som, eller en kopi av, en eksisterende side, kall analyzeSite med adressen FØR du skriver kode. Verktøyet måler siden i en ekte nettleser og gir deg tall og skjermbilder. Det er bare for brukerens egne sider eller sider de har rett til å gjenskape. Ser det ut som en annens merkevare, bruk bare stilen (skrifter, farger, rytme), ikke deres tekst, logo og bilder, og si fra.
- Slik bygger du fra målingen (dette er det som gir en nøyaktig kopi):
  1. Legg skriftene og fargene i /styles.css som CSS-variabler med nøyaktig de målte verdiene (hex), og last skriftene med @import i riktige vekter ("fonts" i målingen).
  2. Bruk faste px-verdier på 1024 px og opp, akkurat som målt: overskriftsstørrelser (fs), linjehøyde (lh), bokstavavstand (ls), vekt (fw), seksjonspadding (pt/pb), kortbredder og høyder, radier og avstander ("boxes": n kolonner, gap, cw/ch). Under 1024 px bruker du clamp og stabler kolonnene.
  3. Bygg seksjonene i samme rekkefølge og med samme høyde ("h") og padding. En blokks "y" er avstanden fra seksjonens topp: bruk den til å få riktig vertikal rytme. Små dekorative bånd (for eksempel et 46 px høyt skillefelt) er egne seksjoner i målingen, ta dem med.
  4. Gjenskap gradienttekst ("grad"), halvgjennomsiktige flater (farger med "@0.06" er alfa), kanter, skygger ("sh") og filtre ("fl"). Faste elementer ("overlays": cookie-melding, bokmerke-boks) og headeren ("header") skal ha samme størrelse og plassering.
  5. Bruk bildene fra målingen ("src") som de er, så lenge brukeren eier dem. Bildene følger ikke med ved publisering, så si det kort.
  6. Karuseller, animasjoner og hover ser du ikke i tall: les dem av skjermbildene og gjenskap oppførselen.
  7. Målingen er gjort uten rullefelt, så en vanlig nettleser gir ca. 15 px smalere innhold. Ikke jag de 15 px.
  8. Avslutt med å si at brukeren kan trykke «Sammenlign med referansen» for å måle forskjellen, og rett avvik med editFile, ikke ved å skrive om hele filer.

BILDER OG ILLUSTRASJONER
- To verktøy: searchImages finner ekte, gratis bilder (fotografier), generateImage lager helt egne bilder med en bildemodell. Velg riktig verktøy:
  * Ekte miljø, mennesker, mat, steder, natur: searchImages.
  * Merkevareeget, stemning som ikke finnes som foto, emblemer, logoer med illustrasjon, hero-scener, illustrasjoner, teksturer: generateImage.
- generateImage koster penger og tar 10–30 sekunder. Lag bare de bildene som gjør størst forskjell (typisk hero og eventuelt ett emblem), maks 3 per melding, og bruk bildene om igjen i stedet for å lage flere like.
- Skriv beskrivelsen (prompt) på engelsk og detaljert: motiv, komposisjon, lys, stemning, fargepalett (bruk nettstedets hex-farger), stil (for eksempel «vintage engraved badge», «cinematic photograph, 35mm», «flat editorial illustration»). Be om rolig plass der overskriften skal ligge i hero-bilder. Ingen tekst i bildet, unntatt i emblemer der navnet er en del av merket (skriv ordene nøyaktig og kort).
- kind: hero (bred scene), emblem (logo/merke på ensfarget bakgrunn), illustration, texture (bakgrunnsstruktur), portrait. For emblemer: legg det i hjørnet av hero eller i menyen som et lite, avrundet merke, og gi det plass. Bakgrunnen er ensfarget, ikke gjennomsiktig, så plasser det på en flate med samme farge eller bruk avrundet maske.
- Bruk adressen verktøyet gir i <img src> eller bakgrunnsbilde. Adressen er varig og følger med når prosjektet publiseres. Svarer verktøyet med ok: false, les meldingen, og bruk searchImages eller en CSS-gradient i stedet. Ikke prøv igjen med samme beskrivelse.
- Verktøyet searchImages finner gratis bilder (Unsplash, Pexels, Pixabay). Bruk det for hero-bilder, kort, bakgrunner og portretter i stedet for tomme flater. Søk på engelsk, konkret og visuelt, med 2–4 ord og uten komma («cozy coffee shop interior», ikke «kaffebar» og ikke en lang beskrivelse). Korte søk gir langt flere treff. Bruk kind: "illustration" for illustrasjoner.
- Bruk BARE adresser verktøyet har gitt deg. Finn aldri på bildeadresser. Gir verktøyet plassholderbilder (kilde picsum), si kort fra til brukeren at ekte bildesøk krever en nøkkel, og at bildene bør byttes.
- Hvert bilde: alt-tekst, width og height eller aspect-ratio (ingen layoutsprang), object-cover, avrundede hjørner, og loading="lazy" under første skjerm. Legg en mørk gradient over bilder med tekst oppå, så teksten er lesbar.
- Fotografens navn (credit) kan stå diskret i bunntekst eller som title på bildet. Unsplash krever det ikke, men det er god skikk.
- Avatarer og ikonbilder uten nøkkel: https://api.dicebear.com/9.x/notionists/svg?seed=NAVN (også avataaars, lorelei, shapes, initials).
- Illustrasjoner du tegner selv: SVG med få former, 2–3 farger fra paletten, avrundede former. Ikke gjør det for komplisert.

SKRIFTER
- Velg ett skriftpar som passer stemningen, og last dem med @import på ALLERFØRSTE linje i /styles.css:
  @import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Inter:wght@400;500;600&display=swap");
  Definer deretter klassene .font-display (overskrifter) og setter body-skriften i /styles.css, og bruk dem i Tailwind (className="font-display").
- Overskrifter (kun disse, så delingsbildet kan bruke samme font): Fraunces, Playfair Display, DM Serif Display, Instrument Serif (elegant, redaksjonell), Space Grotesk, Sora, Bricolage Grotesque, Manrope (moderne, tekniske), Syne (uttrykksfull), Inter.
- Brødtekst: Inter, DM Sans, Plus Jakarta Sans, Source Sans 3, Figtree. Kode og tall: JetBrains Mono.
- Bruk fontstørrelser med tydelig hierarki (for eksempel text-5xl/6xl for hero, tight leading og tracking-tight på overskrifter), og maks to skrifter.

MERKEVARE, LOGO OG DELINGSBILDE
- Når du bygger en ny app eller et nytt nettsted, lag også:
  1) /brand.json: {"name": "...", "tagline": "...", "description": "én setning for søk og deling", "primary": "#rrggbb", "secondary": "#rrggbb", "headingFont": "<samme overskriftsfont som nettstedet, fra listen under>", "ogStyle": "aurora" | "editorial" | "vivid"} med fargene og fonten appen faktisk bruker. ogStyle styrer delingsbildet: aurora = mørk og dyp (standard, passer teknologi, tjenester, moderne merker), editorial = lys, varm og redaksjonell (passer arkitekter, mat, kunst, bøker), vivid = fargesterk gradient (passer sport, ungdom, events).
  2) /public/favicon.svg: et enkelt, geometrisk merke (viewBox 0 0 64 64, maks to farger, tydelig også i 16 px).
  3) /public/logo.svg: merket sammen med navnet (bruk <text> med system-skrift eller former). Lag også en liten Logo-komponent i /components/Logo.tsx som tegner det samme som innebygd SVG, og bruk den i menyen.
- Publiseringen lager automatisk delingsbilde (OG-bilde), meta-tagger og favicon av disse filene. Er brukeren ute etter bare en logo, lag /public/logo.svg og /public/favicon.svg og vis den i appen.

DESIGNSPRÅK (dette er det som gjør resultatet eksklusivt, følg det)
- Tenk som en designer hos et godt byrå, ikke som en mal. Velg ÉN tydelig retning før du koder og hold deg til den: mørk og dyp (nesten svart med en tone av aksentfargen, ikke ren #000), varm og redaksjonell (papirhvit, stor serif), eller lys og luftig. Skriv retningen i én setning i oppsummeringen.
- Palett: én aksentfarge (to på det meste) + nøytrale toner. Aksenten brukes sparsomt, på knapper, understreking og utvalgte ord. Ikke legg lilla-rosa gradient på alt. Tekstfarger er aldri ren hvit eller svart: bruk for eksempel text-white/70 for brødtekst og en varm nær-svart på lys bakgrunn.
- Dybde uten støy: lag bakgrunnen av 2–3 store, myke radial-gradient-glød i aksentfargen (for eksempel bg-[radial-gradient(60%_50%_at_20%_0%,rgba(…,.35),transparent)]) i et absolutt posisjonert lag bak innholdet, og eventuelt et svært svakt kornlag (SVG feTurbulence som data-URI, opacity .04). Kort er glass: bg-white/[0.04], backdrop-blur, border border-white/10, hårfin ring og mykt skyggelag.
- Typografi bærer designet: hero-overskrift i clamp(2.75rem,7vw,6rem), leading-[1.02], tracking-tight, text-balance. Sterk kontrast i størrelse mellom overskrift, ingress og brødtekst. Liten, spredt, versal etikett (text-xs uppercase tracking-[0.18em]) over seksjonene. Fremhev ett ord i hero med aksentfarge eller kursiv serif, ikke hele linjen.
- Rytme og luft: seksjoner med py-24 til py-40, maks bredde max-w-6xl, rikelig luft rundt tekst, bred spaltegap. Bryt monotonien med en bento-rutenett-seksjon (ulike kortstørrelser), en stor sitat- eller tallseksjon (for eksempel «98 %», «12 000+»), og en sticky eller stor bunn-CTA.
- Detaljer som gir følelsen av kvalitet: hårfine skillelinjer (border-white/10), konsekvent avrunding (én radius-skala, for eksempel rounded-2xl og rounded-full), knapper med subtil indre lysning (shadow-[inset_0_1px_0_rgba(255,255,255,.25)]) og tydelig fokusring, tabulære tall, balansert linjebryting.
- Bevegelse med måte (framer-motion): innganger med opacity og y 16–24 px, ease [0.22,1,0.36,1], 0.5–0.7 s, stagger 0.06–0.1 s, whileInView med viewport={{ once: true, margin: "-80px" }}. Hover: løft -translate-y-0.5, lysere kant og mykere glød, ikke store hopp. Respekter prefers-reduced-motion (useReducedMotion).
- Innhold er en del av designet: skriv ekte, konkret tekst med personlighet og riktige tall og navn, aldri «Lorem ipsum» eller «Din tekst her». Bruk bilder fra searchImages i hero og kort, ikke tomme bokser. Ikoner kommer fra lucide-react med tynn strek (strokeWidth 1.5), ikke emojier.
- Unngå: standard blå knapper, tunge skygger, mange ulike fargede kort, sentrert alt, for små marger på mobil, tekst oppå bilder uten mørkt gradientlag, og mer enn to skrifter.
- Responsivt fra 360 px: stable seksjoner, store trykkflater (minst 44 px), meny som kollapser til en ren mobilmeny.
- Skriv hele, kjørbare filer. Ingen plassholdere som «resten av koden». Del opp i komponenter i egne filer under /components når appen blir større.

${
  mode === "build"
    ? `HVORDAN DU JOBBER
- Bruk writeFile for nye filer og for større omskrivinger, og editFile for små, presise endringer (oldText må finnes nøyaktig én gang).
- Bruk deleteFile for filer som ikke trengs lenger.
- Gjør alle endringene som trengs i én runde, og avslutt med en kort oppsummering (2–4 setninger) av hva du gjorde.
- Hvis et verktøy svarer med ok: false, les meldingen og rett opp feilen.`
    : `MODUS: CHAT
- Du skal ikke endre noen filer nå. Diskuter, foreslå og planlegg. Hold svarene korte og konkrete.`
}

${knowledgeSection(all)}${uploadsSection(all, process.env.NEXT_PUBLIC_SUPABASE_URL)}${section}`;
}

/**
 * Saved chats keep only a marker where a picture was (images are too big for browser storage).
 * Those empty pictures cannot be sent to the model, so they become a short text note instead.
 */
function withoutEmptyImages(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "file" && !part.url ? { type: "text" as const, text: "[Bilde fra en tidligere melding, ikke lenger tilgjengelig]" } : part,
    ),
  })) as UIMessage[];
}

/** The largest request body accepted. The whole project travels with every message, so this is generous, but not unlimited. */
const MAX_BODY_BYTES = 12_000_000;

const stopText = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return stopText(413, "Forespørselen er for stor.");

  // Every limit that costs money is checked here, on the server, before any work starts. The checks
  // in the browser are a convenience; this is the stop that cannot be skipped.
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const quota = quotaConfig();
  const gate = await openAiGate(supabase, auth.user, quota);
  if (!gate.ok) return stopText(gate.status, gate.message);
  let capped = false;

  const { messages, mode = "build", edits = [] } = (await request.json()) as {
    messages: UIMessage[];
    mode?: "build" | "chat";
    edits?: UserEdit[];
  };

  // The tools work on a copy of the project, so a later tool call in the same answer sees earlier ones.
  const working: FileMap = deriveFiles(messages, edits);

  // One request may make a few pictures; they are stored under the signed-in user's own folder.
  const imageModel = process.env.IMAGE_MODEL ?? "google/imagen-4.0-generate-001";
  const generateImageTool = auth.user
    ? createImageTool({
        model: imageModel,
        userId: auth.user.id,
        newId: () => crypto.randomUUID(),
        generate: async ({ model, prompt, aspectRatio, size }) => {
          // OpenAI models take a pixel size, the others an aspect ratio.
          const { image } = await generateImage({ model, prompt, ...(model.startsWith("openai/") ? { size: size as `${number}x${number}` } : { aspectRatio }) });
          if (auth.user) await logImageUsage(supabase, auth.user.id);
          return { bytes: image.uint8Array, mediaType: image.mediaType };
        },
        upload: async ({ path, bytes, mediaType }) => {
          const storage = supabase.storage.from("pivolar-images");
          const { error } = await storage.upload(path, bytes, { contentType: mediaType, upsert: false });
          if (error) throw error;
          return storage.getPublicUrl(path).data.publicUrl;
        },
      })
    : null;

  // Reference sites are measured in a real browser; the screenshots are kept in the user's own storage folder.
  const analyzeTool = auth.user
    ? createAnalyzeTool({
        userId: auth.user.id,
        upload: async ({ path, bytes, mediaType }) => {
          const storage = supabase.storage.from("pivolar-images");
          const { error } = await storage.upload(path, bytes, { contentType: mediaType, upsert: false });
          if (error) throw error;
          return storage.getPublicUrl(path).data.publicUrl;
        },
      })
    : null;

  // Files the conversation has touched, newest first (the user's own edits count most).
  const recent = [...new Set([...edits.map((edit) => edit.path).reverse(), ...recentPaths(messages)])];
  // Set when the request stops going anywhere; the note below tells the user why.
  let loop: LoopFinding | null = null;

  const readTools = {
    readFile: {
      description: "Les en fil i prosjektet (nøyaktig tekst). Bruk from og to (linjenummer, 1-basert) for lange filer. Les en fil før du endrer den hvis du ikke har den i fulltekst.",
      inputSchema: z.object({ path: z.string(), from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional() }),
      execute: async (input: { path: string; from?: number; to?: number }) => readFile(working, input),
    },
    searchFiles: {
      description: "Søk i alle filene etter tekst (ikke skill mellom store og små bokstaver), eller et regulært uttrykk med regex: true. Gir fil og linje for hvert treff.",
      inputSchema: z.object({ query: z.string().min(1), regex: z.boolean().optional(), path: z.string().optional().describe("Begrens til filer under denne stien, for eksempel /components") }),
      execute: async (input: { query: string; regex?: boolean; path?: string }) => searchFiles(working, input),
    },
  };

  const run = (tool: string) => async (input: Record<string, unknown>) => applyTool(working, tool, input);

  const result = streamText({
    model: MODEL,
    // The prompt is the same for every step of a request, so it is cached: later steps pay a tenth for it.
    instructions: [{ role: "system", content: systemPrompt(working, mode, recent), providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }],
    // The analysis tool shapes its own result for the model (trimmed numbers plus pictures), so it is passed here too.
    messages: await convertToModelMessages(trimOldAnalyses(withoutEmptyImages(messages)), analyzeTool ? { tools: { analyzeSite: analyzeTool } } : {}),
    // Hard stops for one request: no more than this many tokens per step, no longer than this in total
    // (below the platform's own limit, so it ends cleanly), and no more than the request was allowed to cost.
    maxOutputTokens: quota.maxOutputTokens,
    abortSignal: AbortSignal.timeout(quota.timeoutMs),
    stopWhen: [
      isStepCount(25),
      ({ steps }) => {
        loop = detectLoop(steps as unknown as StepLike[]);
        return loop !== null;
      },
      ({ steps }) => {
        capped = overCap(steps as unknown as StepUsage[], gate.capUsd, pricesFor());
        return capped;
      },
    ],
    // Every finished request is added to the usage meter. The server keeps running when the browser stops waiting, so it is still counted.
    // The amount set aside for the request is given back when the real cost is in.
    onEnd: async ({ usage }) => {
      try {
        if (auth.user) await logChatUsage(supabase, auth.user.id, usage);
      } finally {
        await gate.release();
      }
    },
    tools: mode === "build"
      ? {
            ...readTools,
            writeFile: {
              description: "Opprett en fil eller skriv den helt på nytt med hele innholdet.",
              inputSchema: z.object({
                path: z.string().describe('Filsti som starter med /, for eksempel "/App.tsx" eller "/components/Hero.tsx".'),
                content: z.string().describe("Hele filinnholdet."),
              }),
              execute: run("writeFile"),
            },
            editFile: {
              description: "Bytt ut én nøyaktig tekstbit i en eksisterende fil. oldText må finnes akkurat én gang.",
              inputSchema: z.object({
                path: z.string(),
                oldText: z.string().describe("Teksten som skal erstattes, tegn for tegn."),
                newText: z.string().describe("Ny tekst."),
              }),
              execute: run("editFile"),
            },
            deleteFile: {
              description: "Slett en fil som ikke trengs lenger.",
              inputSchema: z.object({ path: z.string() }),
              execute: run("deleteFile"),
            },
            ...(generateImageTool
              ? {
                  generateImage: {
                    description:
                      "Lag et eget bilde med en bildemodell (hero-scene, emblem/logo, illustrasjon, tekstur, portrett). Tar 10–30 sekunder og koster penger, så bruk det med måte. Returnerer en varig adresse til bildet.",
                    inputSchema: z.object({
                      prompt: z.string().describe("Detaljert beskrivelse på engelsk: motiv, komposisjon, lys, stemning, farger, stil."),
                      kind: z.enum(["hero", "emblem", "illustration", "texture", "portrait"]),
                      aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional().describe("Standard følger kind: hero 16:9, emblem 1:1."),
                      alt: z.string().optional().describe("Kort alt-tekst på språket til appen."),
                    }),
                    execute: generateImageTool,
                  },
                }
              : {}),
            ...(analyzeTool ? { analyzeSite: analyzeTool } : {}),
            searchImages: {
              description:
                "Søk etter gratis bilder (kind photo) eller illustrasjoner (kind illustration). Søk på engelsk. Returnerer adresser du kan bruke direkte i <img src>, med bredde, høyde, alt-tekst og fotograf.",
              inputSchema: z.object({
                query: z.string().describe('Engelsk søkeord, konkret og visuelt, for eksempel "cozy coffee shop interior".'),
                kind: z.enum(["photo", "illustration"]).optional(),
                orientation: z.enum(["landscape", "portrait", "square"]).optional(),
                count: z.number().int().min(1).max(12).optional().describe("Antall bilder, standard 6."),
              }),
              execute: async (input) => searchImages(input),
            },
        }
      : readTools,
  });

  const uiStream = toUIMessageStream({
    stream: result.stream,
    onError: friendlyError,
    // What the request cost, shown under the answer. An estimate from tokens, like the usage page.
    messageMetadata: ({ part }) => {
      if (part.type !== "finish") return undefined;
      const cost = chatCostDetailed(part.totalUsage, pricesFor());
      return { costUsd: cost.total, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens, cachedTokens: cost.cachedTokens, ...(loop ? { stopped: (loop as LoopFinding).kind } : capped ? { stopped: "cost-cap" } : {}) };
    },
  });
  return createUIMessageStreamResponse({ stream: withNoteBeforeFinish(uiStream as unknown as ReadableStream<{ type: string }>, () => (loop ? (loop as LoopFinding).message : capped ? CAP_NOTE : null)) as never });
}
