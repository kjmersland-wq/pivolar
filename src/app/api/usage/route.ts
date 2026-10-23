import { NextResponse } from "next/server";
import { z } from "zod";
import { isOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { summarize, type BudgetSettings, type UsageRow } from "@/lib/usage/summary";

/** How far back rows are read. The curve shows 30 days; the rest feeds the totals. */
const MAX_ROWS = 20_000;

async function owner() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return isOwner(data.user?.email) ? { supabase, userId: data.user!.id } : null;
}

async function readSettings(supabase: NonNullable<Awaited<ReturnType<typeof owner>>>["supabase"]): Promise<BudgetSettings | null> {
  const { data, error } = await supabase.from("user_settings").select("budget_usd, budget_period, budget_starts_at").maybeSingle();
  if (error) return null;
  return {
    budgetUsd: data?.budget_usd === null || data?.budget_usd === undefined ? null : Number(data.budget_usd),
    period: data?.budget_period === "month" ? "month" : "total",
    startsAt: data?.budget_starts_at ?? null,
  };
}

/** Usage so far, the curve and the budget state. */
export async function GET() {
  const auth = await owner();
  if (!auth) return new NextResponse("Unauthorized", { status: 401 });

  const settings = await readSettings(auth.supabase);
  const { data: rows, error } = await auth.supabase
    .from("usage")
    .select("created_at, kind, estimated_cost_usd")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  // A missing table or policy means the usage migration has not been run yet; say so instead of showing zeros.
  if (error || !settings) return NextResponse.json({ error: "Forbruksmåleren er ikke satt opp. Kjør migrasjonen 20261023170000_pivolar_usage.sql i Supabase." }, { status: 503 });

  return NextResponse.json({ ...summarize((rows ?? []) as UsageRow[], settings), truncated: (rows?.length ?? 0) >= MAX_ROWS });
}

const Body = z.object({
  /** Replaces the budget. Null removes it. */
  budgetUsd: z.number().min(0).max(100_000).nullable().optional(),
  period: z.enum(["month", "total"]).optional(),
  /** Adds to the budget, for "I have topped up". */
  addUsd: z.number().min(0.01).max(100_000).optional(),
});

export async function PUT(request: Request) {
  const auth = await owner();
  if (!auth) return new NextResponse("Unauthorized", { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ugyldig beløp." }, { status: 400 });
  const body = parsed.data;

  const current = await readSettings(auth.supabase);
  if (!current) return NextResponse.json({ error: "Forbruksmåleren er ikke satt opp. Kjør migrasjonen 20261023170000_pivolar_usage.sql i Supabase." }, { status: 503 });

  const period = body.period ?? current.period;
  let budgetUsd = body.budgetUsd !== undefined ? body.budgetUsd : current.budgetUsd;
  if (body.addUsd !== undefined) budgetUsd = Math.round(((budgetUsd ?? 0) + body.addUsd) * 100) / 100;

  // A new prepaid amount starts counting now; topping up the same amount keeps the original start.
  const restart = body.budgetUsd !== undefined || (body.period !== undefined && body.period !== current.period);
  const { error } = await auth.supabase.from("user_settings").upsert(
    {
      owner_id: auth.userId,
      budget_usd: budgetUsd,
      budget_period: period,
      ...(restart || !current.startsAt ? { budget_starts_at: new Date().toISOString() } : {}),
    },
    { onConflict: "owner_id" },
  );
  if (error) return NextResponse.json({ error: "Kunne ikke lagre budsjettet." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
