import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isUuid } from "@/lib/oauth/core";
import { limit } from "@/lib/quota/server";
import { createClient } from "@/lib/supabase/server";
import { BUCKET, checkUpload, publicUrl, storagePath, UPLOAD_LIMITS } from "@/lib/uploads/rules";

export const maxDuration = 30;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sign"), projectId: z.string(), name: z.string().max(200), size: z.number(), type: z.string().max(100).optional() }),
  z.object({ action: z.literal("remove"), path: z.string().max(300) }),
]);

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * Hands out signed addresses for adding files, and removes them again. The file itself never passes through
 * here: the browser sends it straight to storage. What is checked first: the user is signed in, the file is
 * a known plain type of a fitting size, the user has room, and the file goes in the user's own folder.
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4_000) return fail(413, "Forespørselen er for stor.");
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Ugyldig forespørsel.");
  const stopped = await limit("uploads");
  if (stopped) return stopped;
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return fail(401, "Du må logge inn.");
  const body = parsed.data;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  if (body.action === "remove") {
    // A path outside the user's own folder is refused here, and storage refuses it again.
    if (!body.path.startsWith(`${auth.user.id}/`) || /\.\./.test(body.path)) return fail(403, "Du kan bare slette dine egne filer.");
    const { error } = await db.storage.from(BUCKET).remove([body.path]);
    return error ? fail(502, "Kunne ikke slette filen.") : NextResponse.json({ ok: true });
  }

  if (!isUuid(body.projectId)) return fail(400, "Ugyldig prosjekt.");
  const checked = checkUpload({ name: body.name, size: body.size, type: body.type });
  if (!checked.ok) return fail(400, checked.error);

  // The room is checked before an address is handed out. If it cannot be checked, nothing is added.
  const { data: used, error: usedError } = await db.rpc("upload_bytes_used");
  if (usedError) return fail(503, "Opplasting er ikke satt opp. Kjør migrasjonen 20261024240000_pivolar_uploads.sql i Supabase.");
  if (Number(used) + body.size > UPLOAD_LIMITS.perUserBytes) return fail(413, `Du har brukt opp lagringsplassen (${UPLOAD_LIMITS.perUserBytes / 1024 / 1024 / 1024} GB). Slett noen filer først.`);

  const path = storagePath(auth.user.id, body.projectId, checked.name, randomBytes(4).toString("hex"));
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return fail(502, "Kunne ikke gjøre klart opplastingen.");
  return NextResponse.json({ path, token: data.token, url: publicUrl(supabaseUrl, path), name: checked.name, mime: checked.mime });
}
