import { NextResponse } from "next/server";
import { z } from "zod";
import { limit } from "@/lib/quota/server";
import { ImportFetchError } from "@/lib/import/safe-fetch";
import { toSkeleton, roughTokens } from "@/lib/import/skeleton";
import { fetchWordPress, probeWordPress } from "@/lib/import/wordpress";

export const maxDuration = 120;

const Body = z.object({
  action: z.enum(["probe", "fetch"]),
  url: z.string().min(3).max(300),
  /** The owner says the site is theirs. Cloning someone else's site is what this must not become. */
  confirmOwner: z.literal(true),
});

/**
 * Reads a website into Pivolar's content model, with plain code and no AI.
 *   probe: is it WordPress, can it be read through the API, and how much is there?
 *   fetch: read the pages, posts and pictures, and report what could not be turned into content.
 * Rate limits and the on/off switch for imports apply (see lib/quota).
 */
export async function POST(request: Request) {
  const stopped = await limit("import");
  if (stopped) return stopped;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Skriv inn adressen og bekreft at nettstedet er ditt." }, { status: 400 });
  const { action, url } = parsed.data;

  try {
    const probe = await probeWordPress(url);
    if (action === "probe") return NextResponse.json({ probe });
    if (!probe.rest) return NextResponse.json({ error: probe.notes[0] ?? "Innholdet kan ikke leses herfra ennå.", probe }, { status: 422 });

    const model = await fetchWordPress(url, probe);
    // What the AI step will have to read, if it is used: the skeletons, not the texts.
    const skeletonTokens = model.pages.reduce((sum, page) => sum + roughTokens(toSkeleton(page.blocks).text), 0);
    return NextResponse.json({ model, ai: { skeletonTokens, pages: model.pages.length } });
  } catch (error) {
    if (error instanceof ImportFetchError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "blocked" ? 400 : 502 });
    return NextResponse.json({ error: "Importen feilet uventet." }, { status: 500 });
  }
}
