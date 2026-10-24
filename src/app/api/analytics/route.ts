import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth";
import type { Hit } from "@/lib/analytics/summary";
import { createClient } from "@/lib/supabase/server";

const MAX_ROWS = 50_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page views of one project for the last 30 days, for the owner only. The row-level policy checks ownership again. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!isOwner(auth.user?.email)) return new NextResponse("Unauthorized", { status: 401 });

  const project = new URL(request.url).searchParams.get("project") ?? "";
  if (!UUID.test(project)) return NextResponse.json({ error: "Ugyldig prosjekt." }, { status: 400 });

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("site_hits")
    .select("created_at, path, source, referrer_host, country, device, visitor")
    .eq("project_id", project)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  // A missing table means the analytics migration has not been run yet; say so instead of showing zeros.
  if (error) return NextResponse.json({ error: "Analysen er ikke satt opp. Kjør migrasjonen 20261024120000_pivolar_analytics.sql i Supabase." }, { status: 503 });
  return NextResponse.json({ hits: (data ?? []) as Hit[], truncated: (data?.length ?? 0) >= MAX_ROWS });
}
