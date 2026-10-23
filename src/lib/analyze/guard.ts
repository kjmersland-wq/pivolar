import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The analyser opens pages on the server, so it must never be steerable to the server's own network.
 * Only public http(s) addresses are allowed, and every request the page makes is checked again.
 */

export class AnalyzeError extends Error {}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/i;

function v4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

/** True for addresses that are reachable from the open internet. */
export function isPublicIp(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const address = mapped ? mapped[1]! : ip.toLowerCase();
  const parts = v4(address);
  if (parts) {
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (isIP(address) === 6) {
    if (address === "::" || address === "::1") return false;
    if (/^f[cd]/.test(address)) return false; // unique local
    if (/^fe[89ab]/.test(address)) return false; // link-local
    if (/^ff/.test(address)) return false; // multicast
    return true;
  }
  return false;
}

const cache = new Map<string, boolean>();

/** Resolves a host name and requires every address it points to to be public. */
export async function isPublicHost(host: string, resolver: (h: string) => Promise<{ address: string }[]> = (h) => lookup(h, { all: true })): Promise<boolean> {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!name || BLOCKED_NAMES.test(name)) return false;
  if (isIP(name)) return isPublicIp(name);
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    const addresses = await resolver(name);
    ok = addresses.length > 0 && addresses.every((a) => isPublicIp(a.address));
  } catch {
    ok = false;
  }
  cache.set(name, ok);
  return ok;
}

/** Validates the address the user typed. Returns the normalised URL. */
export async function assertPublicUrl(input: string, resolver?: Parameters<typeof isPublicHost>[1]): Promise<URL> {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new AnalyzeError("Det ser ikke ut som en gyldig adresse.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AnalyzeError("Bare http- og https-adresser kan analyseres.");
  if (url.username || url.password) throw new AnalyzeError("Adressen kan ikke inneholde brukernavn eller passord.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new AnalyzeError("Bare standardportene 80 og 443 er tillatt.");
  if (!(await isPublicHost(url.hostname, resolver))) throw new AnalyzeError("Adressen peker ikke til et offentlig nettsted, så den kan ikke analyseres.");
  return url;
}
