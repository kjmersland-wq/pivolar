import { generateText, Output } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chatModel } from "@/lib/ai-model";
import { designSchema, sanitizeDesign } from "@/lib/import/design";
import { DESIGN_SYSTEM, designPrompt } from "@/lib/import/design-prompt";
import { loadModel, saveDesign } from "@/lib/import/job";
import { quotaConfig } from "@/lib/quota/config";
import { checkRate, openAiGate } from "@/lib/quota/gate";
import { createClient } from "@/lib/supabase/server";
import { logChatUsage } from "@/lib/usage/log";

export const maxDuration = 90;

const Body = z.object({ job: z.string().uuid() });

/** The most the model may write: a short brief, not a page. */
const MAX_OUTPUT_TOKENS = 1_200;
const TIMEOUT_MS = 60_000;

const stop = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * The only place the AI is used in an import. It reads a short description of the site (name, menu,
 * colours, the start of a few pages), never the pages themselves, and answers with a design brief
 * chosen from fixed options. The brief is cut down and checked before it is saved. Every limit that
 * costs money is checked here first: signed in, not switched off, the allowance for the route, the
 * service's daily cap and the user's own budget, with an amount set aside that is given back at the end.
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 2_000) return stop(413, "Forespørselen er for stor.");
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return stop(400, "Mangler importen.");

  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  const quota = quotaConfig();
  const rate = await checkRate(db, "design", quota);
  if (!rate.ok) return stop(rate.status, rate.message);
  const gate = await openAiGate(db, auth.user, quota);
  if (!gate.ok) return stop(gate.status, gate.message);

  try {
    const loaded = await loadModel(db, auth.user!.id, parsed.data.job);
    if (!loaded) return stop(404, "Fant ikke importen.");
    const { prompt, paths } = designPrompt(loaded.model);
    const result = await generateText({
      model: chatModel,
      system: DESIGN_SYSTEM,
      prompt,
      output: Output.object({ schema: designSchema }),
      maxOutputTokens: Math.min(MAX_OUTPUT_TOKENS, quota.maxOutputTokens),
      abortSignal: AbortSignal.timeout(Math.min(TIMEOUT_MS, quota.timeoutMs)),
    });
    await logChatUsage(db, auth.user!.id, result.usage);
    const raw = result.output;
    // The model names the page as `path`; the stored brief calls it `href`.
    const design = sanitizeDesign({ ...raw, hero: raw.hero ? { ...raw.hero, cta: raw.hero.cta ? { label: raw.hero.cta.label, href: raw.hero.cta.path } : undefined } : undefined }, paths);
    if (!design) return stop(502, "AI-en ga ikke noe brukbart forslag. Prøv igjen, eller åpne prosjektet uten.");
    if (!(await saveDesign(db, parsed.data.job, design))) return stop(500, "Fikk ikke lagret forslaget.");
    return NextResponse.json({ design });
  } catch {
    return stop(502, "Noe gikk galt hos AI-leverandøren. Prøv igjen om litt, eller åpne prosjektet uten.");
  } finally {
    await gate.release();
  }
}
