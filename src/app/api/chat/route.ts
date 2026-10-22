import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type UIMessage } from "ai";
import { z } from "zod";
import { SANDBOX_DEPENDENCIES, applyTool, deriveFiles, type FileMap } from "@/lib/files";

export const maxDuration = 300;

/** Turns provider errors into something the user can act on, without leaking internals. */
function friendlyError(error: unknown): string {
  const text = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}` : String(error);
  if (/credit card|customer_verification_required/i.test(text)) {
    return "AI Gateway trenger et betalingskort på Vercel-kontoen din for å låse opp de gratis kredittene. Legg det inn under AI på vercel.com, og prøv igjen.";
  }
  if (/rate.?limit|429/i.test(text)) return "For mange forespørsler akkurat nå. Vent litt og prøv igjen.";
  if (/budget|insufficient|credits/i.test(text)) return "AI-kredittene er brukt opp. Fyll på under AI på vercel.com.";
  if (/auth|token|unauthor|401|oidc/i.test(text)) return "Fikk ikke tilgang til AI Gateway. Kjør «vercel env pull» på nytt, eller sett AI_GATEWAY_API_KEY.";
  return "Noe gikk galt hos AI-leverandøren. Prøv igjen om litt.";
}

const MODEL = process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-sonnet-5.5";

function systemPrompt(files: FileMap, mode: "build" | "chat") {
  const listing = Object.entries(files)
    .map(([path, content]) => `--- ${path}\n${content}`)
    .join("\n\n");
  return `Du er Atelier, en erfaren designer og frontend-utvikler som bygger små apper sammen med brukeren.
Brukeren skriver vanligvis norsk. Svar på samme språk som brukeren, kort og vennlig, og skriv teksten i selve appen på språket brukeren ber om.

PROSJEKTET
- Det er en React + TypeScript-app som kjører i en nettleser-sandbox (Sandpack). Inngangen er /index.tsx, som importerer ./App og ./styles.css. Ikke endre /index.tsx uten god grunn.
- Styling er Tailwind CSS (via CDN, alle vanlige klasser virker). Bruk /styles.css bare til det Tailwind ikke dekker.
- Tillatte pakker: react, react-dom, ${Object.keys(SANDBOX_DEPENDENCIES).join(", ")}. Ikke importer noe annet.
- Ingen backend, ingen filsystem og ingen miljøvariabler. Lagre data i komponenttilstand eller localStorage.
- Bilder: bruk gradienter, SVG eller ikoner fra lucide-react. Ikke finn på bildeadresser.

KVALITET (viktig)
- Resultatet skal se premium og gjennomarbeidet ut: god typografi og luft, tydelig hierarki, mykt avrundede flater, fine skygger, subtile gradienter og små animasjoner (framer-motion) der det gir mening.
- Responsivt fra mobil til desktop, med tilstander for hover, fokus og tomt innhold.
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

GJELDENDE FILER
${listing}`;
}

export async function POST(request: Request) {
  const { messages, mode = "build" } = (await request.json()) as { messages: UIMessage[]; mode?: "build" | "chat" };

  // The tools work on a copy of the project, so a later tool call in the same answer sees earlier ones.
  const working: FileMap = deriveFiles(messages);

  const run = (tool: string) => async (input: Record<string, unknown>) => applyTool(working, tool, input);

  const result = streamText({
    model: MODEL,
    instructions: systemPrompt(working, mode),
    messages: await convertToModelMessages(messages),
    stopWhen: isStepCount(25),
    ...(mode === "build"
      ? {
          tools: {
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
          },
        }
      : {}),
  });

  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, onError: friendlyError }) });
}
