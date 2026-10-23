/**
 * Free image search for the AI's searchImages tool. Photos come from Unsplash, then Pexels, then
 * Pixabay, whichever has a key; without any key a placeholder service is used and the result says
 * so. Illustrations come from Pixabay. Only the keys are secrets; everything returned is public.
 */

export type ImageKind = "photo" | "illustration";
export type ImageHit = {
  /** Hotlink-ready address. */
  url: string;
  width: number;
  height: number;
  alt: string;
  credit: string;
  creditUrl: string;
  source: "unsplash" | "pexels" | "pixabay" | "picsum";
};
export type ImageSearchResult = { ok: boolean; message: string; images: ImageHit[] };

type Env = Record<string, string | undefined>;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Input = { query: string; kind?: ImageKind; orientation?: "landscape" | "portrait" | "square"; count?: number };

const TIMEOUT_MS = 8000;
const UTM = "utm_source=pivolar&utm_medium=referral";

async function getJson<T>(fetcher: Fetcher, url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

type UnsplashResponse = {
  results?: { width: number; height: number; alt_description?: string | null; description?: string | null; urls: { raw: string }; user: { name: string; links: { html: string } } }[];
};

async function unsplash(fetcher: Fetcher, key: string, query: string, orientation: string, count: number): Promise<ImageHit[] | null> {
  const orient = orientation === "square" ? "squarish" : orientation;
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=${orient}&content_filter=high`;
  const data = await getJson<UnsplashResponse>(fetcher, url, { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" });
  if (!data?.results?.length) return null;
  return data.results.map((r) => ({
    // `raw` is Unsplash's resizable address; the parameters pick a sensible size and format.
    url: `${r.urls.raw}${r.urls.raw.includes("?") ? "&" : "?"}w=1600&q=80&auto=format&fit=crop`,
    width: r.width,
    height: r.height,
    alt: r.alt_description ?? r.description ?? query,
    credit: `${r.user.name} / Unsplash`,
    creditUrl: `${r.user.links.html}?${UTM}`,
    source: "unsplash" as const,
  }));
}

type PexelsResponse = {
  photos?: { width: number; height: number; alt?: string; photographer: string; photographer_url: string; src: { large2x: string } }[];
};

async function pexels(fetcher: Fetcher, key: string, query: string, orientation: string, count: number): Promise<ImageHit[] | null> {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=${orientation}`;
  const data = await getJson<PexelsResponse>(fetcher, url, { Authorization: key });
  if (!data?.photos?.length) return null;
  return data.photos.map((p) => ({
    url: p.src.large2x,
    width: p.width,
    height: p.height,
    alt: p.alt || query,
    credit: `${p.photographer} / Pexels`,
    creditUrl: p.photographer_url,
    source: "pexels" as const,
  }));
}

type PixabayResponse = {
  hits?: { imageWidth: number; imageHeight: number; tags: string; largeImageURL: string; user: string; pageURL: string }[];
};

async function pixabay(fetcher: Fetcher, key: string, query: string, kind: ImageKind, orientation: string, count: number): Promise<ImageHit[] | null> {
  const type = kind === "illustration" ? "illustration" : "photo";
  const orient = orientation === "landscape" ? "horizontal" : orientation === "portrait" ? "vertical" : "all";
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&image_type=${type}&orientation=${orient}&per_page=${Math.max(count, 3)}&safesearch=true`;
  const data = await getJson<PixabayResponse>(fetcher, url);
  if (!data?.hits?.length) return null;
  return data.hits.slice(0, count).map((h) => ({
    url: h.largeImageURL,
    width: h.imageWidth,
    height: h.imageHeight,
    alt: h.tags || query,
    credit: `${h.user} / Pixabay`,
    creditUrl: h.pageURL,
    source: "pixabay" as const,
  }));
}

/** Stable, keyword-seeded placeholders for when no image service has a key. Not related to the query. */
function placeholders(query: string, orientation: string, count: number): ImageHit[] {
  const [width, height] = orientation === "portrait" ? [1000, 1500] : orientation === "square" ? [1200, 1200] : [1600, 1000];
  const seed = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "pivolar";
  return Array.from({ length: count }, (_, i) => ({
    url: `https://picsum.photos/seed/${seed}-${i + 1}/${width}/${height}`,
    width,
    height,
    alt: query,
    credit: "Picsum Photos (Unsplash-bilder, tilfeldig utvalg)",
    creditUrl: "https://picsum.photos",
    source: "picsum" as const,
  }));
}

export async function searchImages(input: Input, env: Env = process.env, fetcher: Fetcher = fetch): Promise<ImageSearchResult> {
  const query = input.query.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!query) return { ok: false, message: "Mangler søkeord.", images: [] };
  const kind = input.kind ?? "photo";
  const orientation = input.orientation ?? "landscape";
  const count = Math.min(Math.max(Math.round(input.count ?? 6), 1), 12);

  if (kind === "illustration") {
    const found = env.PIXABAY_API_KEY ? await pixabay(fetcher, env.PIXABAY_API_KEY, query, "illustration", orientation, count) : null;
    if (found) return { ok: true, message: `Fant ${found.length} illustrasjoner fra Pixabay.`, images: found };
    return {
      ok: false,
      message: env.PIXABAY_API_KEY
        ? "Fant ingen illustrasjoner. Prøv et enklere engelsk søkeord, eller tegn illustrasjonen selv som SVG."
        : "Illustrasjonssøk er ikke satt opp (PIXABAY_API_KEY mangler). Tegn illustrasjonen selv som SVG.",
      images: [],
    };
  }

  const tried: string[] = [];
  const sources: [string, (() => Promise<ImageHit[] | null>) | null][] = [
    ["Unsplash", env.UNSPLASH_ACCESS_KEY ? () => unsplash(fetcher, env.UNSPLASH_ACCESS_KEY!, query, orientation, count) : null],
    ["Pexels", env.PEXELS_API_KEY ? () => pexels(fetcher, env.PEXELS_API_KEY!, query, orientation, count) : null],
    ["Pixabay", env.PIXABAY_API_KEY ? () => pixabay(fetcher, env.PIXABAY_API_KEY!, query, "photo", orientation, count) : null],
  ];
  for (const [name, run] of sources) {
    if (!run) continue;
    tried.push(name);
    const found = await run();
    if (found) return { ok: true, message: `Fant ${found.length} bilder fra ${found[0]!.source === "unsplash" ? "Unsplash" : name}.`, images: found };
  }

  const reason = tried.length ? `Ingen treff hos ${tried.join(" og ")}.` : "Ingen bildetjeneste er satt opp (UNSPLASH_ACCESS_KEY, PEXELS_API_KEY eller PIXABAY_API_KEY).";
  return {
    ok: true,
    message: `${reason} Her er tilfeldige plassholderbilder som ikke matcher søket. Si fra til brukeren at de bør byttes ut.`,
    images: placeholders(query, orientation, count),
  };
}
