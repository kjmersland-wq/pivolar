import { NextResponse } from "next/server";
import { z } from "zod";
import { PROTECTED_PATHS } from "@/lib/files";
import { countChanges, diffImport } from "@/lib/github/changes";
import { openPullRequest } from "@/lib/github/pr";
import { downloadBranch, GITHUB_READ_OPTIONS, GitHubImportError } from "@/lib/github/repo";
import { readZip } from "@/lib/zip/read";

export const maxDuration = 120;

const Body = z.object({
  owner: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  repo: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  baseBranch: z.string().min(1).max(200),
  baseSha: z.string().length(40),
  /** The project's files as they are now. The server compares them with the imported commit. */
  files: z.record(z.string().max(300), z.string().max(1_000_000)),
  title: z.string().min(3).max(120).default("Endringer fra Pivolar"),
  body: z.string().max(5000).default(""),
  /** Only list what would change. */
  dryRun: z.boolean().optional(),
});

/** Whether sending changes back is possible (a token is set). Only yes/no, never the token. */
export async function GET() {
  return NextResponse.json({ token: Boolean(process.env.GITHUB_TOKEN) });
}

/**
 * Compares the project with the commit it was imported from and opens a pull request with the
 * difference. The imported branch itself is never changed.
 */
export async function POST(request: Request) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN mangler i miljøvariablene, så Pivolar kan ikke skrive til GitHub." }, { status: 400 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  const { owner, repo, baseBranch, baseSha, files, title, body, dryRun } = parsed.data;
  try {
    // The imported commit is read again, so the comparison does not depend on what the browser remembers.
    const { zip } = await downloadBranch({ owner, repo, branch: baseSha }, token);
    const baseline = readZip(zip, GITHUB_READ_OPTIONS).files;
    const changes = diffImport(baseline, Object.fromEntries(Object.entries(files).filter(([path]) => !PROTECTED_PATHS.has(path))));
    const summary = { write: Object.keys(changes.write), remove: changes.remove };
    if (countChanges(changes) === 0) return NextResponse.json({ error: "Ingen endringer å sende.", ...summary }, { status: 400 });
    if (dryRun) return NextResponse.json(summary);
    return NextResponse.json({ ...(await openPullRequest(token, { owner, repo, baseBranch, baseSha, ...changes, title, body })), ...summary });
  } catch (error) {
    if (error instanceof GitHubImportError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Kunne ikke sende endringene til GitHub." }, { status: 500 });
  }
}
