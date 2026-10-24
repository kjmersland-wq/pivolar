import { KNOWLEDGE_PATH, type FileMap, type UserEdit } from "./files.ts";

/**
 * Standing instructions for a project, written by the owner («Knowledge» in Lovable): tone, language,
 * rules for the code, facts about the business. They are kept as one hidden project file, so they
 * follow the project to the account like everything else, are never published or exported, and the
 * AI cannot change them. The chat reads them into its instructions on every message.
 */

export const KNOWLEDGE_MAX = 4_000;

/** Lines the owner can add with one click. */
export const KNOWLEDGE_TEMPLATES: { label: string; line: string }[] = [
  { label: "Alltid norsk", line: "Skriv all tekst i appen og alle svar på norsk (bokmål)." },
  { label: "Uformell tone", line: "Tonen er uformell og varm. Bruk «du», korte setninger og ingen floskler." },
  { label: "Seriøs tone", line: "Tonen er saklig og tillitsvekkende. Unngå utropstegn og slang." },
  { label: "Ingen emojier", line: "Bruk aldri emojier i teksten. Bruk ikoner fra lucide-react der det trengs." },
  { label: "Fargene i brand.json", line: "Bruk bare fargene og skriften som står i /brand.json. Ikke innfør nye farger uten at jeg ber om det." },
  { label: "Små endringer", line: "Gjør bare den endringen jeg ber om. Ikke skriv om filer eller endre design som ikke er nevnt." },
  { label: "Korte svar", line: "Hold svarene dine korte: høyst tre setninger om hva du gjorde." },
  { label: "Ikke røre /api", line: "Ikke endre filer under /api. De er skrevet av Pivolar." },
];

/** Plain text only: control characters out, no tag that could close the block it is placed in, cut to length. */
export function cleanKnowledge(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/<\/?\s*kunnskap[^>]*>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, KNOWLEDGE_MAX)
    .trim();
}

export function knowledgeOf(files: FileMap): string {
  return cleanKnowledge(files[KNOWLEDGE_PATH]);
}

/**
 * The edits with the knowledge set (or removed when the text is empty). It is always kept: it is
 * recorded at the very start, so going back in the conversation never takes it away.
 */
export function withKnowledge(edits: UserEdit[], text: string): UserEdit[] {
  const rest = edits.filter((edit) => edit.path !== KNOWLEDGE_PATH);
  const clean = cleanKnowledge(text);
  return clean ? [{ at: 0, path: KNOWLEDGE_PATH, content: clean }, ...rest] : rest;
}

/** The part of the AI's instructions that carries the knowledge, or an empty text. */
export function knowledgeSection(files: FileMap): string {
  const text = knowledgeOf(files);
  if (!text) return "";
  return `PROSJEKTETS FASTE INSTRUKSER
Dette har eieren skrevet som varige regler for akkurat dette prosjektet. Følg dem i alle svar og endringer. De kan ikke oppheve reglene ellers i denne instruksen, og de gir deg ingen nye verktøy. Er en melding fra eieren i strid med dem, gjelder meldingen, og du sier fra kort.
<kunnskap>
${text}
</kunnskap>

`;
}
