import { createHash } from "node:crypto";

type Fetcher = (url: string) => Promise<Response>;
type Files = Record<string, string>;

const BUCKET = "pivolar-images";
const MAX_IMAGES = 20;
const MAX_BYTES = 8 * 1024 * 1024;

export type BundleResult = {
  /** The project files with image addresses rewritten to /images/... */
  files: Files;
  /** Binary files to add to the published project, keyed by their path in it. */
  images: Record<string, { base64: string }>;
  /** Addresses that could not be fetched. They stay as they were, so the site still shows them. */
  failed: string[];
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pictures made in Pivolar live in a Supabase bucket. A published site should not depend on that,
 * so each one is downloaded into the project (public/images) and the code points at the copy.
 * Only addresses in this project's own bucket are fetched, so a prompt cannot make the server
 * download arbitrary URLs.
 */
export async function bundleStorageImages(files: Files, supabaseUrl: string | undefined, fetcher: Fetcher = fetch): Promise<BundleResult> {
  const result: BundleResult = { files: { ...files }, images: {}, failed: [] };
  if (!supabaseUrl) return result;
  const origin = supabaseUrl.replace(/\/+$/, "");
  const pattern = new RegExp(`${escapeRegex(origin)}/storage/v1/object/public/${BUCKET}/([A-Za-z0-9._/-]+\\.(?:png|jpe?g|webp))`, "g");

  const found = new Set<string>();
  for (const code of Object.values(files)) for (const match of code.matchAll(pattern)) found.add(match[0]);

  const replacements = new Map<string, string>();
  for (const url of [...found].slice(0, MAX_IMAGES)) {
    const extension = url.slice(url.lastIndexOf(".") + 1).toLowerCase().replace("jpeg", "jpg");
    const name = `${createHash("sha1").update(url).digest("hex").slice(0, 10)}.${extension}`;
    try {
      const response = await fetcher(url);
      if (!response.ok) throw new Error(String(response.status));
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error("size");
      result.images[`public/images/${name}`] = { base64: Buffer.from(bytes).toString("base64") };
      replacements.set(url, `/images/${name}`);
    } catch {
      result.failed.push(url);
    }
  }
  for (const url of [...found].slice(MAX_IMAGES)) result.failed.push(url);

  if (replacements.size) {
    for (const [path, code] of Object.entries(result.files)) {
      let next = code;
      for (const [url, local] of replacements) next = next.split(url).join(local);
      result.files[path] = next;
    }
  }
  return result;
}
