// Builds a portable ZIP of a project with a manifest and a validation report. Secrets are never
// included: secret files are omitted and credential-looking values are redacted.

import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { analyze, type FileMap, type Report } from "./analyze.ts";
import { isSecretFile, redactSecrets } from "./secrets.ts";

export type ExportNotes = {
  /** Files that were not stored in Pivolar (images and other binaries) and must be copied back by hand. */
  skippedBinaries?: string[];
  /** Secret files that were already left out when the project was imported. */
  omittedSecrets?: string[];
};

export type Manifest = {
  tool: "Pivolar";
  generatedAt: string;
  project: string;
  mode: "source" | "vite";
  analysis: Report;
  included: { path: string; bytes: number; sha256: string }[];
  omitted: { path: string; reason: string }[];
  redacted: { path: string; values: number }[];
  manualSteps: string[];
  validation: { ok: boolean; issues: string[] };
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "pivolar-prosjekt";

export function buildExport(input: { name: string; files: FileMap; mode: "source" | "vite"; notes?: ExportNotes; now?: Date }): { zip: Uint8Array; manifest: Manifest; report: string } {
  const analysis = analyze(input.files);
  const omitted: Manifest["omitted"] = [];
  const redacted: Manifest["redacted"] = [];
  const out: Record<string, string> = {};

  for (const [path, content] of Object.entries(input.files)) {
    const clean = path.replace(/^\/+/, "");
    if (isSecretFile(clean)) {
      omitted.push({ path: clean, reason: "kan inneholde hemmeligheter" });
      continue;
    }
    const result = redactSecrets(content);
    if (result.count > 0) redacted.push({ path: clean, values: result.count });
    out[clean] = result.text;
  }

  for (const path of input.notes?.omittedSecrets ?? []) {
    if (!omitted.some((o) => o.path === path)) omitted.push({ path, reason: "ble holdt utenfor allerede ved import" });
  }
  const manualSteps: string[] = [];
  const issues: string[] = [];

  if (analysis.envVars.length > 0 && !("/.env.example" in input.files)) {
    out[".env.example"] = `# Fyll inn egne verdier. Ekte nøkler skal aldri legges i prosjektet.\n${analysis.envVars.map((name) => `${name}=`).join("\n")}\n`;
  }
  if (analysis.envVars.length > 0) manualSteps.push(`Sett miljøvariablene i .env.example: ${analysis.envVars.join(", ")}.`);
  if (omitted.length > 0) manualSteps.push(`Disse filene ble holdt utenfor fordi de kan inneholde hemmeligheter: ${omitted.map((o) => o.path).join(", ")}. Lag dem på nytt der prosjektet skal kjøre.`);
  if (redacted.length > 0) manualSteps.push(`Verdier som lignet nøkler ble byttet ut med REDACTED_BY_PIVOLAR i: ${redacted.map((r) => r.path).join(", ")}. Legg inn dine egne verdier.`);
  const binaries = input.notes?.skippedBinaries ?? [];
  if (binaries.length > 0) manualSteps.push(`${binaries.length} bilder og andre binærfiler ble ikke lagret i Pivolar og følger ikke med. Kopier dem tilbake fra originalen (for eksempel ${binaries.slice(0, 3).join(", ")}).`);
  if (analysis.services.length > 0) manualSteps.push(`Eksterne tjenester må settes opp av deg: ${analysis.services.join(", ")}.`);

  if (["wordpress", "joomla"].includes(analysis.framework.id)) issues.push("CMS-prosjekt: databasen følger ikke med. Eksporten er ufullstendig uten en egen databasedump.");
  if (analysis.framework.id === "unknown") issues.push("Prosjekttypen ble ikke gjenkjent, så oppsettet kunne ikke kontrolleres.");
  if (analysis.packageManager?.startsWith("ukjent")) issues.push("Mangler låsefil, så versjonene kan avvike fra originalen.");
  if (binaries.length > 0) issues.push("Binærfiler mangler.");
  if (analysis.scripts.build === undefined && out["package.json"] !== undefined) issues.push("package.json har ikke noe build-skript.");
  if (!Object.keys(out).some((p) => /^readme(\.md)?$/i.test(p))) {
    const scripts = Object.entries(analysis.scripts).map(([name, command]) => `- \`${name}\`: \`${command}\``);
    out["README.md"] = `# ${input.name}\n\nEksportert fra Pivolar. Se EXPORT-REPORT.md for hva som mangler.\n\n${scripts.length ? `Skript i package.json:\n\n${scripts.join("\n")}\n` : "Ingen skript funnet. Se filene for oppsett.\n"}`;
  }

  const manifest: Manifest = {
    tool: "Pivolar",
    generatedAt: (input.now ?? new Date()).toISOString(),
    project: input.name,
    mode: input.mode,
    analysis,
    included: [],
    omitted,
    redacted,
    manualSteps,
    validation: { ok: issues.length === 0, issues },
  };

  const report = [
    `# Eksportrapport: ${input.name}`,
    "",
    `Type: ${analysis.framework.label}. Pakkebehandler: ${analysis.packageManager ?? "ingen"}.`,
    `Status: ${issues.length === 0 ? "ingen kjente mangler" : "har mangler, se under"}. Dette er ingen garanti for at prosjektet bygger eller er sikkert.`,
    "",
    "## Mangler",
    ...(issues.length ? issues.map((i) => `- ${i}`) : ["- Ingen oppdaget."]),
    "",
    "## Gjør dette selv",
    ...(manualSteps.length ? manualSteps.map((s) => `- ${s}`) : ["- Ingenting."]),
    "",
    "## Utelatt",
    ...(omitted.length ? omitted.map((o) => `- ${o.path}: ${o.reason}`) : ["- Ingenting."]),
    "",
  ].join("\n");
  out["EXPORT-REPORT.md"] = report;

  manifest.included = Object.entries(out)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), sha256: sha(text) }));
  out["PIVOLAR-MANIFEST.json"] = `${JSON.stringify(manifest, null, 2)}\n`;

  const zip = zipSync(Object.fromEntries(Object.entries(out).map(([path, text]) => [path, strToU8(text)])));
  return { zip, manifest, report };
}

export { slug };
