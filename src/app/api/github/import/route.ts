import { NextResponse } from "next/server";
import { z } from "zod";
import { downloadBranch, GITHUB_READ_OPTIONS, GitHubImportError, listBranches, parseRepoInput } from "@/lib/github/repo";
import { analyze } from "@/lib/zip/analyze";
import { ImportError, readZip } from "@/lib/zip/read";

export const maxDuration = 120;

const Body = z.object({
  /** https://github.com/owner/repo, owner/repo and so on. */
  repo: z.string().min(3).max(300),
  branch: z.string().max(200).optional(),
  /** Only list the branches, without importing. */
  branchesOnly: z.boolean().optional(),
});

/** Whether GitHub import can reach private repositories (a token is set). Only yes/no, never the token. */
export async function GET() {
  return NextResponse.json({ token: Boolean(process.env.GITHUB_TOKEN) });
}

/**
 * Imports a branch of a GitHub repository. The branch is downloaded as a ZIP and read by the same
 * checks as an uploaded ZIP: paths, sizes, binaries and files that may hold secrets.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Skriv inn en GitHub-adresse, for eksempel github.com/navn/repo." }, { status: 400 });
  const target = parseRepoInput(parsed.data.repo);
  if (!target) return NextResponse.json({ error: "Det ser ikke ut som en GitHub-adresse. Bruk for eksempel github.com/navn/repo." }, { status: 400 });
  const token = process.env.GITHUB_TOKEN || undefined;

  try {
    if (parsed.data.branchesOnly) return NextResponse.json({ ...(await listBranches(target, token)), repo: `${target.owner}/${target.repo}` });
    const { source, zip } = await downloadBranch({ ...target, branch: parsed.data.branch || target.branch }, token);
    const result = readZip(zip, GITHUB_READ_OPTIONS);
    return NextResponse.json({ ...result, report: analyze(result.files), source });
  } catch (error) {
    if (error instanceof GitHubImportError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ImportError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Importen feilet uventet." }, { status: 500 });
  }
}
