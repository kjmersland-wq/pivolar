import { decryptToken, type GoogleService } from "./core";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** What has to be set before Google sign-in works. Names only, never values. */
export function oauthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const secret = process.env.OAUTH_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !secret || secret.length < 32) return null;
  return { clientId, clientSecret, secret };
}

export const redirectUri = (request: Request) => `${(process.env.OAUTH_REDIRECT_BASE ?? new URL(request.url).origin).replace(/\/$/, "")}/api/oauth/google/callback`;

/**
 * Environment variables a published site needs for the Google services it uses: the client
 * credentials and the decrypted refresh token. Read on the server with the owner's session, so
 * the token reaches Vercel and nothing else.
 */
export async function googleEnvFor(supabase: Supabase, projectId: string): Promise<Record<string, string>> {
  const config = oauthConfig();
  if (!config) return {};
  const { data } = await supabase.from("oauth_connections").select("service, refresh_token, email").eq("project_id", projectId).eq("provider", "google");
  const rows = (data ?? []) as { service: GoogleService; refresh_token: string; email: string | null }[];
  if (rows.length === 0) return {};
  const env: Record<string, string> = { GOOGLE_CLIENT_ID: config.clientId, GOOGLE_CLIENT_SECRET: config.clientSecret };
  // One token per service keeps the permissions apart: gmail only gets the gmail scope, and so on.
  for (const row of rows) {
    const token = await decryptToken(row.refresh_token, config.secret);
    if (token) env[`GOOGLE_REFRESH_TOKEN_${row.service.toUpperCase()}`] = token;
    // The contact form writes to the connected account itself, so the address comes from the sign-in and not from the browser.
    if (row.service === "gmail" && row.email) env.GOOGLE_ACCOUNT_EMAIL = row.email;
  }
  return env;
}
