import type { SiteModel } from "./model.ts";

/**
 * Projects are kept in the browser's own storage first, and that is small (about 5 MB, counted in
 * two-byte characters). A big website would not fit, and a project that is only half saved is worse
 * than a smaller one. So the size is checked before the project is made, and when it is too big the
 * oldest posts are left out, with a note, until it fits. The pages are never left out, and the
 * posts that were left out stay in the import on the server.
 */

/** What the whole storage of this site in the browser may hold, in characters. Well under what browsers allow. */
export const STORAGE_BUDGET = 2_400_000;
/** Room kept for the project list, the import note and what the project grows by. */
export const STORAGE_MARGIN = 60_000;

type StorageLike = { length: number; key(index: number): string | null; getItem(key: string): string | null };

/** Characters used by everything in the storage now. */
export function storageUsed(storage: StorageLike): number {
  let total = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === null) continue;
    total += key.length + (storage.getItem(key)?.length ?? 0);
  }
  return total;
}

/** Characters still free for a new project, never below zero. */
export function storageRoom(storage: StorageLike, budget = STORAGE_BUDGET): number {
  try {
    return Math.max(budget - storageUsed(storage) - STORAGE_MARGIN, 0);
  } catch {
    return 0;
  }
}

/** The size of a project as it is saved: its files as edits, in JSON. */
export const projectSize = (files: Record<string, string>) => JSON.stringify(Object.entries(files).map(([path, content]) => ({ at: 0, path, content }))).length;

export type Fit = { model: SiteModel; files: Record<string, string>; size: number; dropped: number; fits: boolean };

const megabytes = (chars: number) => (chars / 1_000_000).toFixed(1).replace(".", ",");

/**
 * Builds the project, and if it is larger than `room`, leaves out the oldest posts until it is not.
 * `build` makes the files from a model.
 */
export function fitToRoom(model: SiteModel, build: (model: SiteModel) => Record<string, string>, room: number): Fit {
  let files = build(model);
  let size = projectSize(files);
  let current = model;
  let dropped = 0;
  // The size of a post in the project is close to the size of its data, so the first guess is good; a few rounds settle the rest.
  for (let round = 0; round < 6 && size > room; round++) {
    const posts = current.pages.filter((p) => p.kind === "post").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    if (posts.length === 0) break;
    let freed = 0;
    const out = new Set<string>();
    for (const post of posts) {
      if (freed >= (size - room) * 1.05) break;
      out.add(post.id);
      freed += JSON.stringify(post).length;
    }
    current = { ...current, pages: current.pages.filter((p) => !out.has(p.id)) };
    dropped += out.size;
    files = build(current);
    size = projectSize(files);
  }
  if (dropped > 0) {
    const note = `${dropped} eldre innlegg ble ikke tatt med, fordi nettleseren bare har plass til ca. ${megabytes(room)} MB. De ligger fortsatt i importen.`;
    current = { ...current, warnings: [...current.warnings, note] };
    files = build(current);
    size = projectSize(files);
  }
  return { model: current, files, size, dropped, fits: size <= room };
}

export const fullMessage = (size: number, room: number) =>
  `Importen er for stor for nettleserlagringen (${megabytes(size)} MB, det er plass til ${megabytes(room)} MB). Slett gamle prosjekter og prøv igjen.`;
