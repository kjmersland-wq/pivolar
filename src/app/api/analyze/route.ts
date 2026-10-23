import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeSite } from "@/lib/analyze/analyze";
import { AnalyzeError } from "@/lib/analyze/guard";

export const maxDuration = 120;

const Body = z.object({ url: z.string().min(4).max(500) });

/**
 * Measures a public page and returns a summary (no screenshots). Used to check that the browser
 * works where Pivolar runs, and as a building block for an "analyse this site" form.
 * Behind the login gate like every other route.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Skriv inn en adresse." }, { status: 400 });
  const started = Date.now();
  try {
    const { spec, shots, finalUrl } = await analyzeSite(parsed.data.url, { maxBlocks: 40 });
    return NextResponse.json({
      ok: true,
      url: finalUrl,
      ms: Date.now() - started,
      docH: spec.docH,
      fonts: spec.fonts,
      body: spec.body,
      screenshots: shots.length,
      sections: spec.sections.map((s) => ({ top: s.top, h: s.h, blocks: s.blocks.length, heading: s.blocks.find((b) => /^h[1-3]$/.test(b.k))?.t ?? null })),
    });
  } catch (error) {
    if (error instanceof AnalyzeError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Analysen feilet uventet." }, { status: 500 });
  }
}
