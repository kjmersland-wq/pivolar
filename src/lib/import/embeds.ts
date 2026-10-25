import { vimeoId } from "./clean.ts";
import type { Block, Page } from "./model.ts";
import { safeFetch, type FetchLimits, type SafeResponse } from "./safe-fetch.ts";

/**
 * Videos and sound are not copied into Pivolar: that would fill the storage and the owner already has
 * them somewhere. A YouTube video is kept as its address, with the video's own picture shown (the picture
 * is read from YouTube when the page is shown). Vimeo does not give the picture without asking, so it is
 * asked once at import time through Vimeo's public oEmbed address, and only the picture's address is kept.
 * Video and sound files on the old site are kept as addresses too, and played from there.
 */

type Fetcher = (url: string, limits?: FetchLimits) => Promise<SafeResponse>;

export const EMBED_LIMITS = { vimeoLookups: 15, ms: 15_000 };

const walk = (blocks: Block[], visit: (block: Block) => void) => {
  for (const block of blocks) {
    visit(block);
    if (block.type === "columns") for (const column of block.columns) walk(column, visit);
  }
};

/** Adds the picture (and title) of Vimeo videos. A video that cannot be looked up is left as a plain player. */
export async function enrichEmbeds(pages: Page[], fetcher: Fetcher = (url, limits) => safeFetch(url, limits), now: () => number = Date.now): Promise<number> {
  const wanted = new Map<string, Block & { type: "embed" }>();
  for (const page of pages) {
    walk(page.blocks, (block) => {
      if (block.type === "embed" && block.provider === "vimeo" && !block.thumb) {
        const id = vimeoId(block.src);
        if (id && !wanted.has(id) && wanted.size < EMBED_LIMITS.vimeoLookups) wanted.set(id, block);
      }
    });
  }
  const deadline = now() + EMBED_LIMITS.ms;
  const found = new Map<string, { thumb: string; title: string }>();
  for (const id of wanted.keys()) {
    if (now() > deadline) break;
    try {
      const res = await fetcher(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}`)}`, { accept: /json/i, maxBytes: 100_000, timeoutMs: 6_000 });
      if (!res.ok) continue;
      const data = res.json() as { thumbnail_url?: unknown; title?: unknown };
      const thumb = typeof data.thumbnail_url === "string" ? data.thumbnail_url : "";
      // Only a picture on Vimeo's own picture servers is kept.
      if (/^https:\/\/i\.vimeocdn\.com\/[A-Za-z0-9._\/?=&%:-]+$/.test(thumb)) found.set(id, { thumb, title: typeof data.title === "string" ? data.title.replace(/[<>]/g, "").slice(0, 200) : "" });
    } catch {
      // a video that cannot be asked about stays a plain player
    }
  }
  let applied = 0;
  for (const page of pages) {
    walk(page.blocks, (block) => {
      if (block.type !== "embed" || block.provider !== "vimeo") return;
      const info = found.get(vimeoId(block.src) ?? "");
      if (!info) return;
      block.thumb = info.thumb;
      if (info.title) block.title = info.title;
      applied++;
    });
  }
  return applied;
}

/** How many videos and sound files are kept only as links, and how many YouTube and Vimeo videos. */
export function linkedMedia(pages: Page[]): { video: number; audio: number; hosted: number } {
  const out = { video: 0, audio: 0, hosted: 0 };
  for (const page of pages) {
    walk(page.blocks, (block) => {
      if (block.type === "video") out.video++;
      else if (block.type === "audio") out.audio++;
      else if (block.type === "embed" && (block.provider === "youtube" || block.provider === "vimeo")) out.hosted++;
    });
  }
  return out;
}

/** The note for the import report, or null when there is nothing of the kind. */
export function linkedMediaNote(pages: Page[]): string | null {
  const { video, audio, hosted } = linkedMedia(pages);
  if (video + audio + hosted === 0) return null;
  const parts: string[] = [];
  if (hosted) parts.push(`${hosted} YouTube- og Vimeo-${hosted === 1 ? "video vises" : "videoer vises"} med sitt eget bilde og spilles fra YouTube eller Vimeo`);
  if (video || audio) parts.push(`${[video ? `${video} videofil${video === 1 ? "" : "er"}` : "", audio ? `${audio} lydfil${audio === 1 ? "" : "er"}` : ""].filter(Boolean).join(" og ")} er bare lenket og spilles fra det gamle nettstedet så lenge det er på nett`);
  return `Video og lyd er ikke kopiert, for å spare plass: ${parts.join(". ")}. Skal filene bli i prosjektet, kan du legge dem til under Filer i Mer-panelet.`;
}
