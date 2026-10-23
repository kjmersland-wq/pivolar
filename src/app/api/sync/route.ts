import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** The signed-in owner's projects (metadata only). Row-level security limits this to their own rows. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!isOwner(auth.user?.email)) return new NextResponse("Unauthorized", { status: 401 });

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, framework, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Kunne ikke hente prosjektene." }, { status: 500 });

  return NextResponse.json({
    projects: data.map((row) => ({
      id: row.id,
      name: row.name,
      framework: row.framework ?? undefined,
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
    })),
  });
}
