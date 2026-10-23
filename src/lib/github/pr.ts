import type { FileMap } from "../files.ts";
import { GitHubImportError, type RepoRef } from "./repo.ts";

/**
 * Sends changes back to GitHub as a new branch and a pull request. The branch the project was
 * imported from is never written to: the owner reviews and merges the pull request on GitHub.
 */

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const API = "https://api.github.com";

export type PullRequestInput = RepoRef & {
  /** The branch the project was imported from; the pull request targets it. */
  baseBranch: string;
  /** The exact commit that was imported; the new branch starts here. */
  baseSha: string;
  write: FileMap;
  remove: string[];
  title: string;
  body: string;
};

export type PullRequestResult = { branch: string; url: string; number: number; commitUrl: string };

const SHA = /^[0-9a-f]{40}$/i;
const BRANCH = /^[A-Za-z0-9._\/-]{1,200}$/;

const stamp = (now: Date) => now.toISOString().replace(/[-:T]/g, "").slice(0, 12);

export function branchName(title: string, now = new Date()): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `pivolar/${slug || "endringer"}-${stamp(now)}`;
}

function explain(status: number, message: string): GitHubImportError {
  if (status === 401) return new GitHubImportError("GitHub avviste nøkkelen (GITHUB_TOKEN). Lag en ny og sjekk at den ikke er utløpt.", 401);
  if (status === 403 || status === 404) return new GitHubImportError("GitHub nektet skrivetilgang til repoet. GITHUB_TOKEN trenger tillatelsene «Contents» og «Pull requests» (lese og skrive) for dette repoet.", 403);
  if (status === 422) return new GitHubImportError(`GitHub avviste endringene: ${message}`, 422);
  return new GitHubImportError(`GitHub svarte ${status}. ${message}`.trim(), 502);
}

export async function openPullRequest(token: string, input: PullRequestInput, fetcher: Fetcher = fetch, now = new Date()): Promise<PullRequestResult> {
  const { owner, repo, baseBranch, baseSha } = input;
  if (!SHA.test(baseSha)) throw new GitHubImportError("Mangler utgangspunktet for endringene (commit). Importer repoet på nytt.", 400);
  if (!BRANCH.test(baseBranch)) throw new GitHubImportError("Ugyldig gren.", 400);
  if (Object.keys(input.write).length + input.remove.length === 0) throw new GitHubImportError("Ingen endringer å sende.", 400);

  const call = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    let response: Response;
    try {
      response = await fetcher(`${API}/repos/${owner}/${repo}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pivolar", "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new GitHubImportError("Fikk ikke kontakt med GitHub.", 502);
    }
    const data = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) throw explain(response.status, data.message ?? "");
    return data;
  };

  const base = await call<{ tree: { sha: string } }>(`/git/commits/${baseSha}`);
  const entries = [
    ...Object.entries(input.write).map(([path, content]) => ({ path: path.replace(/^\/+/, ""), mode: "100644", type: "blob", content })),
    // A null sha removes the file from the new tree.
    ...input.remove.map((path) => ({ path: path.replace(/^\/+/, ""), mode: "100644", type: "blob", sha: null })),
  ];
  const tree = await call<{ sha: string }>("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: base.tree.sha, tree: entries }) });
  const commit = await call<{ sha: string; html_url?: string }>("/git/commits", {
    method: "POST",
    body: JSON.stringify({ message: input.title, tree: tree.sha, parents: [baseSha] }),
  });
  const branch = branchName(input.title, now);
  await call("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
  const pull = await call<{ html_url: string; number: number }>("/pulls", {
    method: "POST",
    body: JSON.stringify({ title: input.title, head: branch, base: baseBranch, body: input.body }),
  });
  return { branch, url: pull.html_url, number: pull.number, commitUrl: commit.html_url ?? `https://github.com/${owner}/${repo}/commit/${commit.sha}` };
}
