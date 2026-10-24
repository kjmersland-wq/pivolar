import { parseDomain } from "./names.ts";

/**
 * Connecting a domain bought at Cloudflare to the site: the host is told about the domain, and the DNS
 * records are written in the domain's Cloudflare zone. The domain's zone is in the same account as the
 * purchase, so the same key is used. When the zone is not there (the domain is bought elsewhere), the
 * records are only listed for the owner to set by hand.
 */

const CF = "https://api.cloudflare.com/client/v4";
type Fetcher = typeof fetch;

export type ConnectHost = "cloudflare" | "netlify" | "vercel";
export type DnsRecord = { type: "A" | "CNAME"; name: string; content: string; proxied: boolean };
export const isConnectHost = (host: unknown): host is ConnectHost => host === "cloudflare" || host === "netlify" || host === "vercel";

/** The records a host wants, for the bare domain and for www. `target` is the host's own address for the site. */
export function dnsPlan(host: ConnectHost, domain: string, target: string): DnsRecord[] {
  switch (host) {
    case "cloudflare":
      return [
        { type: "CNAME", name: domain, content: target, proxied: true },
        { type: "CNAME", name: `www.${domain}`, content: target, proxied: true },
      ];
    case "netlify":
      return [
        { type: "A", name: domain, content: "75.2.60.5", proxied: false },
        { type: "CNAME", name: `www.${domain}`, content: target, proxied: false },
      ];
    case "vercel":
      return [
        { type: "A", name: domain, content: "76.76.21.21", proxied: false },
        { type: "CNAME", name: `www.${domain}`, content: "cname.vercel-dns.com", proxied: false },
      ];
  }
}

export type ConnectResult = { domain: string; host: ConnectHost; steps: string[]; records: DnsRecord[]; dnsWritten: boolean; manual: string | null; /** Set when the domain was added to Cloudflare just now: the name servers to give the registrar. */ nameservers?: string[]; zoneCreated?: boolean };

class ConnectError extends Error {}

async function cf<T>(fetcher: Fetcher, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(`${CF}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
  const body = (await response.json().catch(() => ({}))) as { success?: boolean; errors?: { message?: string }[]; result?: T };
  if (!response.ok || body.success === false) throw Object.assign(new ConnectError(`Cloudflare svarte ${response.status}${body.errors?.[0]?.message ? `: ${body.errors[0].message}` : ""}.`), { status: response.status });
  return body.result as T;
}

/** Writes one record in the zone, replacing a record of the same name and type if there is one. */
async function upsert(fetcher: Fetcher, token: string, zone: string, record: DnsRecord): Promise<void> {
  const existing = await cf<{ id: string }[]>(fetcher, token, `/zones/${zone}/dns_records?type=${record.type}&name=${encodeURIComponent(record.name)}`);
  const body = JSON.stringify({ type: record.type, name: record.name, content: record.content, proxied: record.proxied, ttl: 1 });
  if (existing?.[0]) await cf(fetcher, token, `/zones/${zone}/dns_records/${existing[0].id}`, { method: "PUT", body });
  else await cf(fetcher, token, `/zones/${zone}/dns_records`, { method: "POST", body });
}

export type ConnectOptions = {
  host: ConnectHost;
  domain: string;
  /** The name of the site at the host: the Pages project, the Netlify site or the Vercel project. */
  site: string;
  /** The domain is not in this Cloudflare account yet (bought elsewhere): add it, write the records, and say which name servers to set at the registrar. */
  addZone?: boolean;
  env?: Record<string, string | undefined>;
  fetcher?: Fetcher;
};

export async function connectDomain(options: ConnectOptions): Promise<ConnectResult> {
  const parsed = parseDomain(options.domain);
  if (!parsed) throw new ConnectError("Ugyldig domenenavn.");
  const domain = parsed.name;
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const cfToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const account = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!cfToken || !account) throw new ConnectError("CLOUDFLARE_API_TOKEN og CLOUDFLARE_ACCOUNT_ID må være satt.");
  const steps: string[] = [];
  let target = "";

  // 1. The host is told about the domain.
  if (options.host === "cloudflare") {
    const base = `/accounts/${encodeURIComponent(account)}/pages/projects/${encodeURIComponent(options.site)}/domains`;
    for (const name of [domain, `www.${domain}`]) {
      try {
        await cf(fetcher, cfToken, base, { method: "POST", body: JSON.stringify({ name }) });
      } catch (error) {
        // A domain that is already attached is fine.
        if ((error as { status?: number }).status !== 409) throw error;
      }
    }
    target = `${options.site}.pages.dev`;
    steps.push(`${domain} og www.${domain} er lagt til i Cloudflare Pages-prosjektet «${options.site}».`);
  } else if (options.host === "netlify") {
    const token = env.NETLIFY_TOKEN?.trim();
    if (!token) throw new ConnectError("NETLIFY_TOKEN mangler.");
    const find = await fetcher(`https://api.netlify.com/api/v1/sites?name=${encodeURIComponent(options.site)}&filter=all`, { headers: { Authorization: `Bearer ${token}` } });
    const sites = (await find.json().catch(() => [])) as { id: string; name: string }[];
    const site = Array.isArray(sites) ? sites.find((s) => s.name === options.site) : undefined;
    if (!find.ok || !site) throw new ConnectError(`Fant ikke Netlify-siden «${options.site}». Publiser til Netlify først.`);
    const update = await fetcher(`https://api.netlify.com/api/v1/sites/${site.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ custom_domain: domain, domain_aliases: [`www.${domain}`] }) });
    if (!update.ok) throw new ConnectError(`Netlify svarte ${update.status} da domenet skulle legges til.`);
    target = `${options.site}.netlify.app`;
    steps.push(`${domain} og www.${domain} er lagt til på Netlify-siden «${options.site}».`);
  } else {
    const token = env.VERCEL_TOKEN?.trim();
    if (!token) throw new ConnectError("VERCEL_TOKEN mangler.");
    const team = env.VERCEL_TEAM_ID?.trim();
    for (const name of [domain, `www.${domain}`]) {
      const response = await fetcher(`https://api.vercel.com/v10/projects/${encodeURIComponent(options.site)}/domains${team ? `?teamId=${encodeURIComponent(team)}` : ""}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      // 409 means it is already on the project.
      if (!response.ok && response.status !== 409) throw new ConnectError(`Vercel svarte ${response.status} da ${name} skulle legges til.`);
    }
    target = "cname.vercel-dns.com";
    steps.push(`${domain} og www.${domain} er lagt til på Vercel-prosjektet «${options.site}».`);
  }

  // 2. The DNS records, in the domain's own zone at Cloudflare when it is there.
  const records = dnsPlan(options.host, domain, target);
  let dnsWritten = false;
  let manual: string | null = null;
  const zones = await cf<{ id: string }[]>(fetcher, cfToken, `/zones?name=${encodeURIComponent(domain)}&account.id=${encodeURIComponent(account)}`).catch(() => []);
  let zone = zones?.[0]?.id;
  let nameservers: string[] | undefined;
  let zoneCreated = false;
  if (!zone && options.addZone) {
    // The domain is bought elsewhere: it is added to Cloudflare, and the registrar is told to use Cloudflare's name servers.
    const created = await cf<{ id: string; name_servers?: string[] }>(fetcher, cfToken, "/zones", { method: "POST", body: JSON.stringify({ name: domain, account: { id: account }, type: "full" }) });
    zone = created.id;
    nameservers = (created.name_servers ?? []).filter((n) => /^[a-z0-9.-]+$/i.test(n));
    zoneCreated = true;
    steps.push(`${domain} er lagt til i Cloudflare. Bytt navnetjenere hos den som har domenet til ${nameservers.join(" og ") || "de to Cloudflare viser for domenet"}. Når det er gjort, tar Cloudflare over.`);
  }
  if (zone) {
    for (const record of records) await upsert(fetcher, cfToken, zone, record);
    dnsWritten = true;
    steps.push("DNS-oppføringene er skrevet i Cloudflare. Sertifikatet (https) lages av verten og kan ta noen minutter.");
  } else {
    manual = `Fant ikke ${domain} i Cloudflare-kontoen din, så DNS må settes hos den som har domenet: ${records.map((r) => `${r.type} ${r.name} → ${r.content}`).join(", ")}.`;
    steps.push(manual);
  }
  return { domain, host: options.host, steps, records, dnsWritten, manual, ...(nameservers ? { nameservers } : {}), ...(zoneCreated ? { zoneCreated } : {}) };
}
