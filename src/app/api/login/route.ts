import { NextResponse } from "next/server";
import { authConfigured, isOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "Innlogging er ikke satt opp (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY og APP_EMAIL mangler)." },
      { status: 500 },
    );
  }
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return NextResponse.json({ error: "Fyll inn e-post og passord." }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  // One message for every failure, so a wrong address is not distinguishable from a wrong password.
  if (error || !isOwner(data.user?.email)) {
    if (!error) await supabase.auth.signOut();
    return NextResponse.json({ error: "Feil e-post eller passord." }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
