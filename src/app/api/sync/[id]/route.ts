import { NextResponse } from "next/server";
import { z } from "zod";
import { isOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Vercel rejects request bodies over 4.5 MB, so say so plainly before that happens.
const MAX_BODY = 4_000_000;

const Body = z.object({
  name: z.string().min(1).max(120),
  framework: z.string().max(60).nullish(),
  createdAt: z.number().optional(),
  messages: z.array(z.unknown()),
  edits: z.array(z.unknown()),
  publish: z.unknown().nullish(),
  importInfo: z.unknown().nullish(),
});

type Ctx = { params: Promise<{ id: string }> };

async function owner() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return isOwner(data.user?.email) ? { supabase, userId: data.user!.id } : null;
}

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ugyldig id." }, { status: 400 });
  const auth = await owner();
  if (!auth) return new NextResponse("Unauthorized", { status: 401 });

  const [{ data: project }, { data: state }] = await Promise.all([
    auth.supabase.from("projects").select("import_info").eq("id", id).maybeSingle(),
    auth.supabase.from("project_state").select("messages, edits, publish").eq("project_id", id).maybeSingle(),
  ]);
  if (!project) return NextResponse.json({ error: "Fant ikke prosjektet." }, { status: 404 });
  return NextResponse.json({
    messages: state?.messages ?? [],
    edits: state?.edits ?? [],
    publish: state?.publish ?? null,
    importInfo: project.import_info ?? null,
  });
}

export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ugyldig id." }, { status: 400 });
  const auth = await owner();
  if (!auth) return new NextResponse("Unauthorized", { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ error: "Prosjektet er for stort til å lagres på kontoen (over 4 MB)." }, { status: 413 });
  }
  let parsed;
  try {
    parsed = Body.safeParse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Ugyldig innhold." }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: "Ugyldig innhold." }, { status: 400 });
  const body = parsed.data;

  const { data: project, error } = await auth.supabase
    .from("projects")
    .upsert(
      {
        id,
        owner_id: auth.userId,
        name: body.name,
        framework: body.framework ?? null,
        import_info: body.importInfo ?? null,
        ...(body.createdAt ? { created_at: new Date(body.createdAt).toISOString() } : {}),
      },
      { onConflict: "id" },
    )
    .select("updated_at")
    .single();
  if (error || !project) return NextResponse.json({ error: "Kunne ikke lagre prosjektet." }, { status: 500 });

  const { error: stateError } = await auth.supabase.from("project_state").upsert(
    { project_id: id, messages: body.messages, edits: body.edits, publish: body.publish ?? null },
    { onConflict: "project_id" },
  );
  if (stateError) return NextResponse.json({ error: "Kunne ikke lagre prosjektet." }, { status: 500 });

  return NextResponse.json({ updatedAt: Date.parse(project.updated_at) });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ugyldig id." }, { status: 400 });
  const auth = await owner();
  if (!auth) return new NextResponse("Unauthorized", { status: 401 });
  const { error } = await auth.supabase.from("projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Kunne ikke slette." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
