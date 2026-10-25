import { UPLOADS_PATH, type FileMap, type UserEdit } from "../files.ts";

/**
 * Pictures, sound and PDFs that the owner adds to a project. They go straight from the browser to storage
 * (a signed address, so nothing large passes through the server), and the project keeps a list of them.
 * The list is one hidden project file, like the standing instructions, so it follows the project to the
 * account and back. Only plain types are accepted: nothing that can run (no SVG, HTML or scripts).
 */

export const BUCKET = "pivolar-uploads";

export const UPLOAD_LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  /** Files in one project. */
  perProject: 100,
  /** Everything one user keeps in storage. */
  perUserBytes: 1024 * 1024 * 1024,
  /** Chosen at once. */
  batch: 10,
};

/** Extension to what the file is served as. The bucket accepts only these types too. */
export const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
  pdf: "application/pdf",
};

/** Every type the bucket accepts. */
export const MIME_TYPES = [...new Set(Object.values(TYPES)), "audio/x-wav"];

export type Upload = { name: string; url: string; mime: string; bytes: number };

const NAME = /^[a-z0-9][a-z0-9._-]{0,80}$/;

/** A file name that is safe in a path and in an address: lowercase, no spaces, Norwegian letters written out. */
export function safeName(input: string): string {
  const raw = input.split(/[\\/]/).pop() ?? "";
  const dot = raw.lastIndexOf(".");
  const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const base = (dot > 0 ? raw.slice(0, dot) : raw)
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "fil"}${ext ? `.${ext}` : ""}`;
}

export type Checked = { ok: true; name: string; mime: string; ext: string } | { ok: false; error: string };

/** Whether a file may be added: a known type that matches its ending, and a sensible size. */
export function checkUpload(input: { name: unknown; size: unknown; type?: unknown }): Checked {
  if (typeof input.name !== "string" || !input.name.trim()) return { ok: false, error: "Filen mangler navn." };
  const name = safeName(input.name);
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const mime = TYPES[ext];
  if (!mime) return { ok: false, error: `«${input.name.slice(0, 60)}» er ikke en filtype som kan legges til (bilder: png, jpg, webp, gif, avif; lyd: mp3, m4a, aac, ogg, wav, webm; og pdf).` };
  if (typeof input.size !== "number" || !Number.isFinite(input.size) || input.size <= 0) return { ok: false, error: `«${name}» er tom.` };
  if (input.size > UPLOAD_LIMITS.fileBytes) return { ok: false, error: `«${name}» er over ${UPLOAD_LIMITS.fileBytes / 1024 / 1024} MB.` };
  // The browser's own idea of the type must agree with the ending, when it has one.
  if (typeof input.type === "string" && input.type && input.type !== mime && !(mime === "audio/wav" && input.type === "audio/x-wav") && !(ext === "jpg" && input.type === "image/jpeg")) {
    if (!(mime.startsWith("audio/") && input.type.startsWith("audio/")) || input.type.startsWith("text")) return { ok: false, error: `«${name}» ser ikke ut som en ${ext}-fil.` };
  }
  return { ok: true, name, mime, ext };
}

/** Where a file goes in storage: the user's folder, the project's folder and a short random part, so two files with one name never collide. */
export function storagePath(userId: string, projectId: string, name: string, random: string): string {
  return `${userId}/${projectId}/${random}-${name}`;
}

/** The address a file in the bucket is read from. */
export const publicUrl = (supabaseUrl: string, path: string) => `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;

/** The list of uploads in a project's files, cleaned. Entries that do not look right are dropped. */
export function uploadsOf(files: FileMap, supabaseUrl?: string): Upload[] {
  let raw: unknown;
  try {
    raw = JSON.parse(files[UPLOADS_PATH] ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const prefix = supabaseUrl ? `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/` : null;
  const out: Upload[] = [];
  for (const item of raw.slice(0, UPLOAD_LIMITS.perProject)) {
    if (!item || typeof item !== "object") continue;
    const u = item as Record<string, unknown>;
    if (typeof u.name !== "string" || !NAME.test(u.name) || typeof u.url !== "string" || typeof u.mime !== "string" || typeof u.bytes !== "number") continue;
    if (!Object.values(TYPES).includes(u.mime) || !(u.bytes > 0 && u.bytes <= UPLOAD_LIMITS.fileBytes)) continue;
    if (prefix ? !u.url.startsWith(prefix) : !/^https:\/\/[^\s"'<>]+\/storage\/v1\/object\/public\/pivolar-uploads\/[A-Za-z0-9._\/-]+$/.test(u.url)) continue;
    if (/[\s"'<>`\\]|\.\./.test(u.url)) continue;
    out.push({ name: u.name, url: u.url, mime: u.mime, bytes: u.bytes });
  }
  return out;
}

/** The edits with the list set. Recorded at the very start, so going back in the conversation never takes it away. */
export function withUploads(edits: UserEdit[], list: Upload[]): UserEdit[] {
  const rest = edits.filter((edit) => edit.path !== UPLOADS_PATH);
  return list.length ? [{ at: 0, path: UPLOADS_PATH, content: JSON.stringify(list.slice(0, UPLOAD_LIMITS.perProject)) }, ...rest] : rest;
}

/** The part of the AI's instructions that tells it which files the owner has added. */
export function uploadsSection(files: FileMap, supabaseUrl?: string): string {
  const list = uploadsOf(files, supabaseUrl);
  if (list.length === 0) return "";
  const lines = list.map((u) => `- ${u.name} (${u.mime}, ${Math.max(1, Math.round(u.bytes / 1024))} KB): ${u.url}`);
  return `FILER EIEREN HAR LAGT TIL
Eieren har lastet opp disse filene til prosjektet. Bruk dem der de passer (bilder i <img src>, lyd i <audio src>, pdf i en lenke), og bruk adressen slik den står, aldri en egen sti. Når siden publiseres eller sendes som pull request, kopieres filene automatisk inn i prosjektet og adressene byttes. Ikke finn på filnavn som ikke står her.
${lines.join("\n")}

`;
}

/**
 * Replaces the storage address of every upload in the files with the path the file gets in the project, and
 * says which uploads were used. Used when the files leave Pivolar (a pull request), so the code does not depend
 * on Pivolar's storage.
 */
export function localizeUploads(files: FileMap, list: Upload[], folder = "uploads"): { files: FileMap; used: { upload: Upload; path: string }[] } {
  const used: { upload: Upload; path: string }[] = [];
  const out: FileMap = { ...files };
  for (const upload of list) {
    const local = `/${folder}/${upload.name}`;
    let hit = false;
    for (const [path, content] of Object.entries(out)) {
      if (!content.includes(upload.url)) continue;
      out[path] = content.split(upload.url).join(local);
      hit = true;
    }
    if (hit) used.push({ upload, path: `public${local}` });
  }
  return { files: out, used };
}
