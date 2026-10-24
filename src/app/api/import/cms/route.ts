import { NextResponse } from "next/server";
import { z } from "zod";
import { loadModel, runImagesStep, saveJob } from "@/lib/import/job";
import { ImportFetchError } from "@/lib/import/safe-fetch";
import { toSkeleton, roughTokens } from "@/lib/import/skeleton";
import { fetchWordPress, probeWordPress } from "@/lib/import/wordpress";
import { limit } from "@/lib/quota/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const Site = z.object({
  action: z.enum(["probe", "fetch"]),
  url: z.string().min(3).max(300),
  /** The owner says the site is theirs. Cloning someone else's site is what this must not become. */
  confirmOwner: z.literal(true),
});
const Job = z.object({ action: z.enum(["images", "get"]), job: z.string().uuid() });
const Body = z.union([Site, Job]);

/**
 * Reads a website into Pivolar, with plain code and no AI.
 *   probe   is it WordPress, can it be read through the API, and how much is there?
 *   fetch   read pages, posts and the list of pictures into a saved job
 *   images  fetch the next pictures of a job (call until status is images_done)
 *   get     the content model of a job, with the stored pictures filled in
 * Rate limits and the on/off switch for imports apply (see lib/quota).
 */
export async function POST(request: Request) {
  // The requests here are a few lines of JSON, so a large body is refused before it is read.
  if (Number(request.headers.get("content-length") ?? 0) > 20_000) return NextResponse.json({ error: "Forespørselen er for stor." }, { status: 413 });
  const body = await request.json().catch(() => null);
  const parsed = Body.safeParse(body);
  const step = parsed.success && (parsed.data.action === "images" || parsed.data.action === "get");
  // Probing and reading a site start an import; the steps of one that is already running have a larger allowance.
  const stopped = await limit(step ? "importstep" : "import");
  if (stopped) return stopped;
  if (!parsed.success) return NextResponse.json({ error: "Skriv inn adressen og bekreft at nettstedet er ditt." }, { status: 400 });

  try {
    const data = parsed.data;
    if ("job" in data) {
      const db = await createClient();
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) return NextResponse.json({ error: "Du må logge inn." }, { status: 401 });
      if (data.action === "images") return NextResponse.json(await runImagesStep(db, auth.user.id, data.job));
      const loaded = await loadModel(db, auth.user.id, data.job);
      return loaded ? NextResponse.json(loaded) : NextResponse.json({ error: "Fant ikke importen." }, { status: 404 });
    }

    const probe = await probeWordPress(data.url);
    if (data.action === "probe") return NextResponse.json({ probe });
    if (!probe.rest) return NextResponse.json({ error: probe.notes[0] ?? "Innholdet kan ikke leses herfra ennå.", probe }, { status: 422 });

    const model = await fetchWordPress(data.url, probe);
    const db = await createClient();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: "Du må logge inn." }, { status: 401 });
    const job = await saveJob(db, auth.user.id, model.url, model);
    // What the AI step will have to read, if it is used: the skeletons, not the texts.
    const skeletonTokens = model.pages.reduce((sum, page) => sum + roughTokens(toSkeleton(page.blocks).text), 0);
    return NextResponse.json({
      job,
      summary: { name: model.name, ...model.stats, plugins: model.plugins, warnings: model.warnings, truncated: model.truncated },
      ai: { skeletonTokens, pages: model.pages.length },
    });
  } catch (error) {
    if (error instanceof ImportFetchError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "blocked" ? 400 : 502 });
    return NextResponse.json({ error: error instanceof Error && /migrasjonen/.test(error.message) ? error.message : "Importen feilet uventet." }, { status: 500 });
  }
}
