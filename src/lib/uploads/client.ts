"use client";

import { createBrowser } from "@/lib/supabase/client";
import { BUCKET, checkUpload, UPLOAD_LIMITS, type Upload } from "./rules";

/** Adds files to a project: each is checked, given a signed address by the server, and sent straight to storage. */
export async function addFiles(projectId: string, files: File[], onStep?: (text: string) => void): Promise<{ added: Upload[]; errors: string[] }> {
  const added: Upload[] = [];
  const errors: string[] = [];
  const supabase = createBrowser();
  for (const file of files.slice(0, UPLOAD_LIMITS.batch)) {
    const pre = checkUpload({ name: file.name, size: file.size, type: file.type });
    if (!pre.ok) {
      errors.push(pre.error);
      continue;
    }
    onStep?.(`Laster opp ${pre.name} …`);
    try {
      const response = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", projectId, name: file.name, size: file.size, type: file.type }) });
      const signed = (await response.json().catch(() => ({}))) as { path?: string; token?: string; url?: string; name?: string; mime?: string; error?: string };
      if (!response.ok || !signed.path || !signed.token || !signed.url || !signed.name || !signed.mime) {
        errors.push(signed.error ?? (response.status === 429 ? "For mange filer på kort tid. Vent litt." : `Kunne ikke laste opp ${pre.name}.`));
        if (response.status === 429 || response.status === 503) break;
        continue;
      }
      const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(signed.path, signed.token, file, { contentType: signed.mime });
      if (error) {
        errors.push(`Kunne ikke laste opp ${pre.name}.`);
        continue;
      }
      added.push({ name: signed.name, url: signed.url, mime: signed.mime, bytes: file.size });
    } catch {
      errors.push(`Kunne ikke laste opp ${pre.name}.`);
    }
  }
  if (files.length > UPLOAD_LIMITS.batch) errors.push(`Bare de ${UPLOAD_LIMITS.batch} første filene ble tatt med. Legg til resten i en ny runde.`);
  return { added, errors };
}

/** Removes the file from storage. The list in the project is changed by the caller. */
export async function removeFile(upload: Upload): Promise<boolean> {
  const path = upload.url.split(`/${BUCKET}/`)[1];
  if (!path) return false;
  const response = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", path }) });
  return response.ok;
}
