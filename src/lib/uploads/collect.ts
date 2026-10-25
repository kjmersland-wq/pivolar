import { UPLOAD_LIMITS, type Upload } from "./rules.ts";

/**
 * Reads the bytes of the files a project uses, for a pull request. The addresses come from the project's own
 * list and have already been checked to point into Pivolar's upload bucket, so nothing else is ever fetched.
 * The size is checked as the file arrives, and the total is capped.
 */

export const COLLECT_LIMITS = { totalBytes: 60 * 1024 * 1024 };

export type Collected = { path: string; content: Uint8Array };

export async function collectUploads(used: { upload: Upload; path: string }[], fetcher: typeof fetch = fetch): Promise<Collected[]> {
  const out: Collected[] = [];
  let total = 0;
  for (const { upload, path } of used) {
    let response: Response;
    try {
      response = await fetcher(upload.url, { signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error(`Fikk ikke hentet ${upload.name}.`);
    }
    if (!response.ok) throw new Error(`Fikk ikke hentet ${upload.name} (${response.status}).`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > UPLOAD_LIMITS.fileBytes) throw new Error(`${upload.name} er for stor.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > UPLOAD_LIMITS.fileBytes) throw new Error(`${upload.name} har en uventet størrelse.`);
    total += bytes.length;
    if (total > COLLECT_LIMITS.totalBytes) throw new Error(`Filene som skal følge med er over ${COLLECT_LIMITS.totalBytes / 1024 / 1024} MB til sammen. Send dem i flere runder.`);
    out.push({ path, content: bytes });
  }
  return out;
}
