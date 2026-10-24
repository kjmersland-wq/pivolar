import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { approvePurchase, checkDomains, DomainError, purchaseRules, registerDomain, registrationStatus } from "@/lib/domains/cloudflare";
import { connectDomain } from "@/lib/domains/connect";
import { candidates, parseDomain, toLabel } from "@/lib/domains/names";
import { rankDomains } from "@/lib/domains/rank";
import { limit } from "@/lib/quota/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Site = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"),
    brand: z.string().max(80).optional(),
    title: z.string().max(120).optional(),
    description: z.string().max(400).optional(),
    /** Name ideas (from the AI helper) as plain labels. */
    extra: z.array(z.string().max(40)).max(12).optional(),
    /** Names the owner typed. When given, only these are checked. */
    names: z.array(z.string().max(80)).max(20).optional(),
    norwegian: z.boolean().optional(),
    shop: z.boolean().optional(),
    tech: z.boolean().optional(),
  }),
  z.object({ action: z.literal("buy"), domain: z.string().max(80), seenPrice: z.number().positive().max(1000), confirm: z.string().max(80) }),
  z.object({ action: z.literal("status"), domain: z.string().max(80) }),
  z.object({ action: z.literal("connect"), domain: z.string().max(80), host: z.enum(["cloudflare", "netlify", "vercel"]), site: Site, addZone: z.boolean().optional() }),
]);

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/** A purchase being made right now, so a double click or a second tab cannot send it twice. */
const inflight = new Set<string>();

/**
 * Domains: find names that fit the project, check them live at Cloudflare Registrar, buy one, and connect it
 * to the site. Looking costs nothing. Buying is switched off until the owner turns it on, needs the domain
 * typed out as a confirmation, uses the price the owner saw only if it still holds, is written to the log
 * before anything is bought, and is never repeated by itself. See lib/domains/cloudflare.ts.
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 6_000) return fail(413, "Forespørselen er for stor.");
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Ugyldig forespørsel.");
  const body = parsed.data;

  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !account) return fail(503, "Domener krever CLOUDFLARE_API_TOKEN (med tillatelsen Registrar) og CLOUDFLARE_ACCOUNT_ID i miljøvariablene.");
  const rules = purchaseRules();

  try {
    if (body.action === "search") {
      const stopped = await limit("domains");
      if (stopped) return stopped;
      const typed = (body.names ?? []).map((n) => parseDomain(n)?.name).filter((n): n is string => Boolean(n));
      if ((body.names?.length ?? 0) > 0 && typed.length === 0) return fail(400, "Skriv et domenenavn som kaffebar.com.");
      const names = typed.length ? typed : candidates({ ...(body.brand ? { brand: body.brand } : {}), ...(body.title ? { title: body.title } : {}), ...(body.description ? { description: body.description } : {}), extra: (body.extra ?? []).map(toLabel), limit: 40 });
      if (names.length === 0) return fail(400, "Fant ikke noe navn å ta utgangspunkt i. Gi prosjektet et navn først.");
      const found = [];
      for (let i = 0; i < names.length; i += 20) found.push(...(await checkDomains(token, account, names.slice(i, i + 20))));
      const results = rankDomains(found, { ...(body.brand ? { brand: toLabel(body.brand) } : {}), norwegian: body.norwegian ?? true, ...(body.shop ? { shop: true } : {}), ...(body.tech ? { tech: true } : {}) });
      return NextResponse.json({ results, buying: rules.enabled, maxUsd: rules.maxUsd });
    }

    if (body.action === "status") {
      const stopped = await limit("domains");
      if (stopped) return stopped;
      if (!parseDomain(body.domain)) return fail(400, "Ugyldig domenenavn.");
      return NextResponse.json({ registration: await registrationStatus(token, account, body.domain.trim().toLowerCase()) });
    }

    if (body.action === "connect") {
      const stopped = await limit("domains");
      if (stopped) return stopped;
      return NextResponse.json({ connected: await connectDomain({ host: body.host, domain: body.domain, site: body.site, ...(body.addZone ? { addZone: true } : {}) }) });
    }

    // --- buying
    const domain = parseDomain(body.domain)?.name;
    if (!domain) return fail(400, "Ugyldig domenenavn.");
    if (!rules.enabled) return fail(403, "Kjøp av domener er slått av. Sett DOMAIN_BUY_ENABLED=true i miljøvariablene når du vil kunne kjøpe herfra.");
    if (body.confirm.trim().toLowerCase() !== domain) return fail(400, `Skriv «${domain}» nøyaktig for å bekrefte kjøpet.`);
    const stopped = await limit("domainbuy");
    if (stopped) return stopped;
    if (inflight.has(domain)) return fail(409, "Dette domenet kjøpes allerede akkurat nå. Vent på svaret.");
    inflight.add(domain);
    try {
      // What the registry says now, not what was shown earlier.
      const now = (await checkDomains(token, account, [domain])).find((d) => d.name === domain);
      const verdict = approvePurchase({ seen: body.seenPrice, now, maxUsd: rules.maxUsd });
      if (!verdict.ok) return fail(409, verdict.message);

      // The attempt is written down before any money moves. Without a record, nothing is bought.
      const db = await createClient();
      const recorded = await audit(db, "domain_purchase_attempt", { domain, priceUsd: verdict.price, renewalUsd: now?.renewal ?? 0, capUsd: rules.maxUsd });
      if (!recorded) return fail(503, "Kunne ikke skrive kjøpet i loggen, så ingenting er kjøpt. Kjør migrasjonen 20261024220000_pivolar_audit_domains.sql i Supabase.");

      const registration = await registerDomain(token, account, domain);
      await audit(db, "domain_purchase", { domain, priceUsd: verdict.price, state: registration.state });
      return NextResponse.json({ registration, priceUsd: verdict.price });
    } finally {
      inflight.delete(domain);
    }
  } catch (error) {
    if (error instanceof DomainError) return fail(error.status === 401 || error.status === 403 ? 403 : 502, error.message);
    return fail(502, error instanceof Error ? error.message : "Noe gikk galt.");
  }
}
