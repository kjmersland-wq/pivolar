"use client";

import { useRef, useState } from "react";
import { FileArchive, Loader2 } from "lucide-react";
import { ImportReport, type Imported } from "@/components/ImportReport";

/** Uploads a ZIP, shows what was found and only then creates the project. */
export function ImportZip() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<Imported | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setFileName(file.name);
    try {
      const response = await fetch("/api/import/zip", { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
      const body = (await response.json().catch(() => ({}))) as Imported & { error?: string };
      if (!response.ok) setError(body.error ?? "Importen feilet.");
      else setResult(body);
    } catch {
      setError("Fikk ikke kontakt med serveren.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input ref={input} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Velg ZIP-fil" />
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl border border-line bg-surface/60 px-4 py-2.5 text-[13.5px] text-muted backdrop-blur transition enabled:hover:border-line-strong enabled:hover:text-fg disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileArchive className="size-4" />}
          {busy ? "Leser arkivet …" : "Importer et prosjekt fra ZIP"}
        </button>
        {error && <p className="max-w-md text-center text-[13px] text-red-400">{error}</p>}
      </div>
      <ImportReport
        result={result}
        label={fileName}
        defaultName={fileName.replace(/\.zip$/i, "")}
        info={{ source: "zip", fileName }}
        note="Originalarkivet er ikke endret."
        onClose={() => setResult(null)}
      />
    </>
  );
}
