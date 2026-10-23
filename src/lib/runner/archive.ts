import { unzipSync } from "fflate";
import { checkPath } from "../zip/read.ts";

/**
 * Every file of a repository archive, binaries included, for putting into a sandbox. The text
 * import leaves images and big data files out, but a running project needs them. Nothing here is
 * executed; paths are checked the same way as for an import, and the unpacked size is limited
 * before anything is decompressed.
 */

export const ARCHIVE_LIMITS = { files: 5000, bytes: 60_000_000 };

const TOO_BIG = "Repoet er for stort til å kjøres.";

export function archiveFiles(zip: Uint8Array): Record<string, Buffer> {
  let total = 0;
  let count = 0;
  const entries = unzipSync(zip, {
    filter(file) {
      if (file.name.endsWith("/")) return false;
      count++;
      total += file.originalSize;
      if (count > ARCHIVE_LIMITS.files || total > ARCHIVE_LIMITS.bytes) throw new Error(TOO_BIG);
      return true;
    },
  });
  const names = Object.keys(entries);
  // A GitHub archive has one folder around everything.
  const first = names[0]?.split("/")[0];
  const root = first && names.every((n) => n.startsWith(`${first}/`)) ? `${first}/` : "";
  const out: Record<string, Buffer> = {};
  for (const name of names) {
    const checked = checkPath(root ? name.slice(root.length) : name);
    if (!checked.ok || checked.path.split("/").includes("node_modules") || checked.path.startsWith(".git/")) continue;
    out[`/${checked.path}`] = Buffer.from(entries[name]!);
  }
  return out;
}
