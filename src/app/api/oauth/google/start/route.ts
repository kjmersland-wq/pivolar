import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth";
import { authorizeUrl, isGoogleService, isUuid, signState } from "@/lib/oauth/core";
import { oauthConfig, redirectUri } from "@/lib/oauth/server";
import { createClient } from "@/lib/supabase/server";

/** Sends the owner to Google's consent screen for one service of one project. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || !isOwner(auth.user.email)) return new NextResponse("Unauthorized", { status: 401 });

  const config = oauthConfig();
  if (!config) return NextResponse.json({ error: "Google-innlogging er ikke satt opp. Se «Koble til Google» i README." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const project = params.get("project");
  const service = params.get("service");
  if (!isUuid(project) || !isGoogleService(service)) return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });

  // Only a project the owner has can be connected; the row-level policy answers for that.
  const { data: owned } = await supabase.from("projects").select("id").eq("id", project).maybeSingle();
  if (!owned) return NextResponse.json({ error: "Fant ikke prosjektet." }, { status: 404 });

  const state = await signState({ project, service, user: auth.user.id }, config.secret);
  return NextResponse.redirect(authorizeUrl({ clientId: config.clientId, redirectUri: redirectUri(request), service, state }));
}
