import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth";
import { isUuid } from "@/lib/oauth/core";
import { oauthConfig } from "@/lib/oauth/server";
import { createClient } from "@/lib/supabase/server";

/** Whether Google sign-in is set up here, and which services of a project are connected (never the tokens). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!isOwner(auth.user?.email)) return new NextResponse("Unauthorized", { status: 401 });

  const configured = oauthConfig() !== null;
  const project = new URL(request.url).searchParams.get("project");
  if (!configured || !isUuid(project)) return NextResponse.json({ configured, connected: [] });
  const { data, error } = await supabase.from("oauth_connections").select("service, email").eq("project_id", project).eq("provider", "google");
  if (error) return NextResponse.json({ configured, connected: [], error: "OAuth-tabellen mangler. Kjør migrasjonen 20261024140000_pivolar_oauth.sql i Supabase." });
  return NextResponse.json({ configured, connected: data ?? [] });
}

/** Removes a connection. The token stays valid at Google until it is revoked in the Google account's security settings. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!isOwner(auth.user?.email)) return new NextResponse("Unauthorized", { status: 401 });
  const params = new URL(request.url).searchParams;
  const project = params.get("project");
  const service = params.get("service");
  if (!isUuid(project) || !service) return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  await supabase.from("oauth_connections").delete().eq("project_id", project).eq("provider", "google").eq("service", service);
  return NextResponse.json({ ok: true });
}
