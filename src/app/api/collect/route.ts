import { createClient } from "@supabase/supabase-js";
import { classifySource, cleanPath, deviceOf, isBot, referrerHost, visitorId } from "@/lib/analytics/classify";

/**
 * Receives one page view from a published site. It is open to everyone on purpose (the sites live
 * on other addresses), so it only does one thing: validate, reduce to a few values and hand them to
 * record_hit in the database, which checks them again. Nothing is stored that identifies a person.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
const done = () => new Response(null, { status: 204, headers: CORS });

export function OPTIONS() {
  return done();
}

export async function POST(request: Request) {
  // The browser sends text/plain, which avoids a preflight request; the body is still JSON.
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > 2000) return done();
  let body: { s?: unknown; p?: unknown; r?: unknown; m?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return done();
  }
  const project = typeof body.s === "string" && UUID.test(body.s) ? body.s.toLowerCase() : null;
  const path = cleanPath(body.p);
  const userAgent = request.headers.get("user-agent") ?? "";
  if (!project || !path || isBot(userAgent)) return done();

  const referrer = typeof body.r === "string" ? body.r.slice(0, 500) : "";
  const origin = request.headers.get("origin");
  let own: string | undefined;
  try {
    own = origin ? new URL(origin).hostname : undefined;
  } catch {
    own = undefined;
  }
  const host = referrerHost(referrer, own);
  const source = classifySource(host, typeof body.m === "string" ? body.m.slice(0, 40) : "");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const country = request.headers.get("x-vercel-ip-country");
  const day = new Date().toISOString().slice(0, 10);
  const visitor = await visitorId({ ip, userAgent, project, day, salt: process.env.ANALYTICS_SALT ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "pivolar" });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return done();
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  // A failure is not the visitor's problem: the page view is just not counted.
  await supabase.rpc("record_hit", {
    p_project: project,
    p_path: path,
    p_source: source,
    p_referrer_host: host,
    p_country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    p_device: deviceOf(userAgent),
    p_visitor: visitor,
  });
  return done();
}
