import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { AnalyzeError, assertPublicUrl, isPublicIp } from "../analyze/guard.ts";

/**
 * Fetching pages and files from someone else's website, on the server. Two things must hold: the
 * request can never be steered to the server's own network, and one slow or huge answer can never
 * tie it up. So every address is checked before it is opened, again after each redirect, and a
 * third time when the connection is made (so a name that changes its answer in between does not
 * help), and every answer has a size and a time limit.
 */

export type FetchCode = "blocked" | "timeout" | "too-large" | "bad-type" | "redirects" | "network";

export class ImportFetchError extends Error {
  code: FetchCode;
  constructor(code: FetchCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const USER_AGENT = "PivolarImporter/1.0 (+https://pivolar.com)";

export type FetchLimits = {
  /** Wall-clock time for one request, redirects not counted. */
  timeoutMs?: number;
  /** Largest answer, after decompression. */
  maxBytes?: number;
  /** The content types accepted. Anything else is refused after the headers, before the body is read. */
  accept?: RegExp;
  maxRedirects?: number;
  headers?: Record<string, string>;
};

export type SafeResponse = {
  /** The address the answer finally came from, after redirects. */
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: () => string;
  json: () => unknown;
};

type SendOptions = { headers: Record<string, string>; timeoutMs: number; maxBytes: number; accept?: RegExp };
type Raw = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
export type Send = (url: URL, options: SendOptions) => Promise<Raw>;

const DEFAULTS = { timeoutMs: 10_000, maxBytes: 2_000_000, maxRedirects: 3 };

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void;
type Resolver = (hostname: string, options: { all: true; family?: number }, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/**
 * The function the connection uses to turn a name into an address. It answers only when every
 * address is public, so the check happens at the moment of connecting and not just before.
 */
export function publicLookup(resolver: Resolver = dnsLookup as unknown as Resolver) {
  return (hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) => {
    resolver(hostname, { all: true, ...(options.family ? { family: options.family } : {}) }, (error, addresses) => {
      if (error) return callback(error);
      if (addresses.length === 0 || !addresses.every((a) => isPublicIp(a.address))) {
        return callback(Object.assign(new Error("Adressen peker ikke til et offentlig nettsted."), { code: "EBLOCKED" }));
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

const DECODERS: Record<string, () => NodeJS.ReadWriteStream> = {
  gzip: () => zlib.createGunzip(),
  "x-gzip": () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
  br: () => zlib.createBrotliDecompress(),
};

/** A request made with Node's own http(s) and the given way of turning a name into an address. */
export const makeSend =
  (lookup: unknown): Send =>
  (url, options) =>
  new Promise<Raw>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    let finished = false;
    const done = (fn: () => void) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fn();
    };
    const req = transport.request(url, { method: "GET", headers: options.headers, lookup: lookup as never, agent: false }, (res) => {
      const type = String(res.headers["content-type"] ?? "");
      // A type that is not wanted is refused before any of the body is read.
      if (options.accept && res.statusCode && res.statusCode < 300 && !options.accept.test(type)) {
        done(() => reject(new ImportFetchError("bad-type", `Uventet filtype (${type.split(";")[0] || "ukjent"}).`)));
        return req.destroy();
      }
      const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
      const decode = DECODERS[encoding];
      const stream: NodeJS.ReadableStream = decode ? res.pipe(decode()) : res;
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        // Settled at once, before the rest of the body can arrive and finish as if all was well.
        if (size > options.maxBytes) {
          done(() => reject(new ImportFetchError("too-large", "Svaret er for stort.")));
          return req.destroy();
        }
        chunks.push(chunk);
      });
      stream.on("end", () => done(() => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })));
      stream.on("error", (error: Error) => done(() => reject(error)));
    });
    const timer = setTimeout(() => {
      done(() => reject(new ImportFetchError("timeout", "Svaret tok for lang tid.")));
      req.destroy();
    }, options.timeoutMs);
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof ImportFetchError) return done(() => reject(error));
      if (error.code === "EBLOCKED") return done(() => reject(new ImportFetchError("blocked", error.message)));
      done(() => reject(new ImportFetchError("network", "Fikk ikke kontakt med nettstedet.")));
    });
    req.end();
  });

/** The real request: the address of the connection is checked at the moment of connecting. */
export const nodeSend: Send = makeSend(publicLookup());

/** Checks the address itself: only public http(s) addresses on the normal ports, and no passwords in them. */
async function checkUrl(url: URL | string): Promise<URL> {
  try {
    return await assertPublicUrl(typeof url === "string" ? url : url.toString());
  } catch (error) {
    if (error instanceof AnalyzeError) throw new ImportFetchError("blocked", error.message.replace("kan ikke analyseres", "kan ikke hentes"));
    throw error;
  }
}

export type Deps = { send?: Send; checkUrl?: (url: URL | string) => Promise<URL> };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function safeFetch(input: string, limits: FetchLimits = {}, deps: Deps = {}): Promise<SafeResponse> {
  const send = deps.send ?? nodeSend;
  const check = deps.checkUrl ?? checkUrl;
  const maxRedirects = limits.maxRedirects ?? DEFAULTS.maxRedirects;
  let current = await check(input);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const raw = await send(current, {
      headers: { "User-Agent": USER_AGENT, Accept: "*/*", "Accept-Language": "nb,no;q=0.9,en;q=0.8", "Accept-Encoding": "gzip, deflate, br", ...limits.headers },
      timeoutMs: limits.timeoutMs ?? DEFAULTS.timeoutMs,
      maxBytes: limits.maxBytes ?? DEFAULTS.maxBytes,
      ...(limits.accept ? { accept: limits.accept } : {}),
    });
    const location = raw.headers.location;
    if (REDIRECTS.has(raw.status) && location) {
      // Every step of a redirect chain is checked like the first address, so a redirect cannot lead inside.
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new ImportFetchError("network", "Nettstedet videresendte til en ugyldig adresse.");
      }
      current = await check(next);
      continue;
    }
    const contentType = String(raw.headers["content-type"] ?? "");
    return {
      url: current.toString(),
      status: raw.status,
      ok: raw.status >= 200 && raw.status < 300,
      contentType,
      headers: raw.headers,
      body: raw.body,
      text: () => raw.body.toString("utf8"),
      json: () => JSON.parse(raw.body.toString("utf8")) as unknown,
    };
  }
  throw new ImportFetchError("redirects", "Nettstedet videresendte for mange ganger.");
}

// --- robots.txt

type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };

function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  return groups;
}

function matches(pattern: string, path: string): number {
  // * matches anything and a trailing $ means the end; the length of the pattern decides which rule is the most specific.
  const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, (c) => (c === "$" ? "$" : "\\" + c)).replace(/\*/g, ".*"));
  return regex.test(path) ? pattern.replace(/\*/g, "").length : -1;
}

/** Whether a robots.txt allows the importer to fetch a path. The importer's own group wins over the general one. */
export function robotsAllows(robotsText: string, path: string, agent = "pivolarimporter"): boolean {
  const groups = parseRobots(robotsText);
  const own = groups.filter((g) => g.agents.some((a) => a && agent.includes(a) && a !== "*"));
  const chosen = own.length > 0 ? own : groups.filter((g) => g.agents.includes("*"));
  let best = { length: -1, allow: true };
  for (const rule of chosen.flatMap((g) => g.rules)) {
    const length = matches(rule.pattern, path);
    if (length > best.length || (length === best.length && rule.allow)) best = { length, allow: rule.allow };
  }
  return best.allow;
}

/** One robots.txt per site, read once and remembered while an import runs. */
export function createRobots(fetcher: (url: string, limits: FetchLimits) => Promise<SafeResponse> = (url, limits) => safeFetch(url, limits)) {
  const cache = new Map<string, string>();
  return async function allowed(url: string): Promise<boolean> {
    const target = new URL(url);
    let text = cache.get(target.origin);
    if (text === undefined) {
      try {
        const res = await fetcher(`${target.origin}/robots.txt`, { maxBytes: 500_000, timeoutMs: 8_000, accept: /^text\/|^application\/octet-stream/ });
        // A missing file means everything is allowed; a server that fails means the same, since there is no rule to follow.
        text = res.ok ? res.text() : "";
      } catch {
        text = "";
      }
      cache.set(target.origin, text);
    }
    return robotsAllows(text, target.pathname + target.search);
  };
}
