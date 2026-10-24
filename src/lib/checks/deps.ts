import type { FileMap } from "../files.ts";
import type { Finding } from "./quality.ts";

/**
 * Package check: finds the packages the project asks for and asks OSV (the open vulnerability
 * database behind GitHub's advisories) whether those versions have known problems. Without a
 * lockfile the version is the lowest one the range allows, so the answer is the worst case.
 */

export type Dependency = { name: string; version: string; range: string; dev: boolean };
export type Vulnerability = { id: string; summary: string; severity: "high" | "medium" | "low"; fixedIn: string | null };
export type PackageReport = { name: string; version: string; range: string; dev: boolean; vulns: Vulnerability[] };

export const DEPS_LIMITS = { packages: 400, detailed: 30 };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** The lowest concrete version a range allows, or null for ranges that point somewhere else (git, file, latest). */
export function lowestVersion(range: string): string | null {
  const match = /^\s*(?:[\^~]|>=|=)?\s*v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(range);
  if (!match) return null;
  return match[1] ?? null;
}

export function readDependencies(files: FileMap): { dependencies: Dependency[]; skipped: number } {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(files["/package.json"] ?? "{}");
  } catch {
    return { dependencies: [], skipped: 0 };
  }
  const dependencies: Dependency[] = [];
  let skipped = 0;
  for (const [dev, group] of [[false, pkg.dependencies], [true, pkg.devDependencies]] as const) {
    for (const [name, range] of Object.entries(group ?? {})) {
      const version = typeof range === "string" ? lowestVersion(range) : null;
      if (!version) skipped++;
      else dependencies.push({ name, version, range, dev });
    }
  }
  return { dependencies, skipped };
}

type OsvVuln = {
  id: string;
  summary?: string;
  details?: string;
  database_specific?: { severity?: string };
  affected?: { package?: { name?: string }; ranges?: { events?: { fixed?: string }[] }[] }[];
};

const severityOf = (vuln: OsvVuln): Vulnerability["severity"] => {
  const s = (vuln.database_specific?.severity ?? "").toUpperCase();
  return s === "CRITICAL" || s === "HIGH" ? "high" : s === "MODERATE" || s === "MEDIUM" ? "medium" : "low";
};

function fixedFor(vuln: OsvVuln, name: string): string | null {
  const fixes = (vuln.affected ?? [])
    .filter((a) => !a.package?.name || a.package.name === name)
    .flatMap((a) => (a.ranges ?? []).flatMap((r) => (r.events ?? []).flatMap((e) => (e.fixed ? [e.fixed] : []))));
  return fixes[0] ?? null;
}

/** Asks OSV about every package in one batch, then reads the details of the vulnerabilities found. */
export async function checkPackages(dependencies: Dependency[], fetcher: Fetcher = fetch): Promise<PackageReport[]> {
  const list = dependencies.slice(0, DEPS_LIMITS.packages);
  if (list.length === 0) return [];
  const batch = await fetcher("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries: list.map((d) => ({ version: d.version, package: { name: d.name, ecosystem: "npm" } })) }),
  });
  if (!batch.ok) throw new Error(`Pakkedatabasen svarte ${batch.status}.`);
  const results = ((await batch.json()) as { results?: { vulns?: { id: string }[] }[] }).results ?? [];

  const ids = [...new Set(results.flatMap((r) => (r.vulns ?? []).map((v) => v.id)))].slice(0, DEPS_LIMITS.detailed * 4);
  const details = new Map<string, OsvVuln>();
  for (let i = 0; i < ids.length; i += 6) {
    await Promise.all(
      ids.slice(i, i + 6).map(async (id) => {
        try {
          const response = await fetcher(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
          if (response.ok) details.set(id, (await response.json()) as OsvVuln);
        } catch {
          /* one vulnerability without details is still reported by its id */
        }
      }),
    );
  }

  return list.flatMap((dep, i) => {
    const found = results[i]?.vulns ?? [];
    if (found.length === 0) return [];
    const vulns = found.map((v): Vulnerability => {
      const d = details.get(v.id);
      return { id: v.id, summary: (d?.summary ?? d?.details ?? "Kjent sårbarhet").split("\n")[0]!.slice(0, 160), severity: d ? severityOf(d) : "medium", fixedIn: d ? fixedFor(d, dep.name) : null };
    });
    return [{ name: dep.name, version: dep.version, range: dep.range, dev: dep.dev, vulns }];
  });
}

const rank = { high: 0, medium: 1, low: 2 } as const;

/** One finding per package, worst problem first. */
export function packageFindings(reports: PackageReport[]): Finding[] {
  return reports
    .map((report): Finding => {
      const worst = [...report.vulns].sort((a, b) => rank[a.severity] - rank[b.severity])[0]!;
      const fixes = report.vulns.flatMap((v) => (v.fixedIn ? [v.fixedIn] : []));
      const target = fixes.length > 0 ? fixes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)! : null;
      return {
        id: `pkg:${report.name}`,
        severity: report.dev ? (worst.severity === "high" ? "medium" : "low") : worst.severity,
        title: `${report.name} ${report.version} har ${report.vulns.length} kjent${report.vulns.length === 1 ? " feil" : "e feil"}`,
        detail: `${worst.id}: ${worst.summary}${report.dev ? " (bare under utvikling)" : ""}${target ? ` Rettet i ${target}.` : ""}`,
        path: "/package.json",
        fix: target
          ? `Oppdater ${report.name} til ${target} eller nyere i /package.json, og sjekk at siden fortsatt fungerer likt. Endre ikke andre pakker.`
          : `Sjekk ${report.name} i /package.json: ${worst.id} er kjent, men ingen rettet versjon er oppgitt. Finn ut om en nyere versjon finnes, og si fra hvis den ikke gjør det.`,
      };
    })
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}
