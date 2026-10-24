import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth";
import { encryptToken, exchangeCode, verifyState } from "@/lib/oauth/core";
import { oauthConfig, redirectUri } from "@/lib/oauth/server";
import { createClient } from "@/lib/supabase/server";

/** Where Google sends the owner back. The signed state says which project and service this is for. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || !isOwner(auth.user.email)) return new NextResponse("Unauthorized", { status: 401 });

  const config = oauthConfig();
  if (!config) return NextResponse.json({ error: "Google-innlogging er ikke satt opp." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const state = await verifyState(params.get("state") ?? "", config.secret);
  // A state for someone else, an old one or an altered one is refused without saying which.
  if (!state || state.user !== auth.user.id) return NextResponse.json({ error: "Ugyldig eller utløpt forespørsel. Prøv å koble til på nytt." }, { status: 400 });

  const back = new URL(`/p/${state.project}`, request.url);
  const code = params.get("code");
  if (params.get("error") || !code) {
    back.searchParams.set("connect_error", "avbrutt");
    return NextResponse.redirect(back);
  }

  try {
    const { refreshToken, email } = await exchangeCode({ code, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: redirectUri(request) });
    const { error } = await supabase.from("oauth_connections").upsert(
      { owner_id: auth.user.id, project_id: state.project, provider: "google", service: state.service, email, refresh_token: await encryptToken(refreshToken, config.secret) },
      { onConflict: "project_id,provider,service" },
    );
    if (error) throw new Error("db");
    back.searchParams.set("connected", state.service);
  } catch {
    back.searchParams.set("connect_error", "feilet");
  }
  return NextResponse.redirect(back);
}
