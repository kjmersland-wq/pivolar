/**
 * Reading a repository from GitHub for import. The archive for a branch is downloaded in one
 * request and handed to the ZIP reader, so every safety rule that applies to an uploaded ZIP also
 * applies here. A token is optional for public repositories and needed for private ones.
 */

import { THIN_LIMITS, thinArchive, type Thin } from "./thin.ts";

export type RepoRef = { owner: string; repo: string };
export type RepoSource = { owner: string; repo: string; branch: string; sha: string; private: boolean; url: string };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class GitHubImportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const API = "https://api.github.com";
/** Repositories above this size (GitHub reports kilobytes) are refused before anything is downloaded. */
export const MAX_REPO_KB = 50_000;
/** Same as the ZIP reader's limit for the compressed archive. */
export const MAX_ARCHIVE_BYTES = 10_000_000;

/** Accepts https://github.com/owner/repo, github.com/owner/repo/tree/branch, git@github.com:owner/repo.git and owner/repo. */
export function parseRepoInput(input: string): (RepoRef & { branch?: string }) | null {
  const text = input.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  let path: string | null = null;
  const ssh = text.match(/^git@github\.com:(.+)$/i);
  if (ssh) path = ssh[1]!;
  else if (/^https?:\/\//i.test(text) || /^(www\.)?github\.com\//i.test(text)) {
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
      path = url.pathname.replace(/^\/+/, "");
    } catch {
      return null;
    }
  } else if (/^[^/\s]+\/[^/\s]+$/.test(text)) path = text;
  if (!path) return null;
  const [owner, repo, kind, ...rest] = path.split("/");
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return null;
  const branch = kind === "tree" && rest.length > 0 ? decodeURIComponent(rest.join("/")) : undefined;
  return { owner, repo, ...(branch ? { branch } : {}) };
}

function headers(token: string | undefined): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pivolar",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function explain(status: number, hasToken: boolean, what: string): GitHubImportError {
  if (status === 404) {
    return new GitHubImportError(
      hasToken ? `Fant ikke ${what} på GitHub. Sjekk adressen, og at GITHUB_TOKEN har tilgang til repoet.` : `Fant ikke ${what} på GitHub. Er repoet privat, trenger Pivolar GITHUB_TOKEN med repo-tilgang.`,
      404,
    );
  }
  if (status === 401) return new GitHubImportError("GitHub avviste nøkkelen (GITHUB_TOKEN). Lag en ny og sjekk at den ikke er utløpt.", 401);
  if (status === 403 || status === 429) {
    return new GitHubImportError(hasToken ? "GitHub nektet tilgang eller grensen for forespørsler er nådd. Prøv igjen om litt." : "GitHub-grensen for anonyme forespørsler er nådd. Legg inn GITHUB_TOKEN, eller prøv igjen om litt.", 429);
  }
  return new GitHubImportError(`GitHub svarte ${status}.`, 502);
}

async function getJson<T>(fetcher: Fetcher, url: string, token: string | undefined, what: string): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new GitHubImportError("Fikk ikke kontakt med GitHub.", 502);
  }
  if (!response.ok) throw explain(response.status, Boolean(token), what);
  return (await response.json()) as T;
}

/** Branch names for the picker, default branch first. */
export async function listBranches(ref: RepoRef, token: string | undefined, fetcher: Fetcher = fetch): Promise<{ defaultBranch: string; branches: string[]; private: boolean }> {
  const meta = await getJson<{ default_branch: string; private: boolean }>(fetcher, `${API}/repos/${ref.owner}/${ref.repo}`, token, "repoet");
  const list = await getJson<{ name: string }[]>(fetcher, `${API}/repos/${ref.owner}/${ref.repo}/branches?per_page=100`, token, "grenene");
  const names = list.map((b) => b.name);
  return { defaultBranch: meta.default_branch, branches: [meta.default_branch, ...names.filter((n) => n !== meta.default_branch)], private: meta.private };
}

/** Resolves the branch to a commit and downloads that exact commit as a ZIP. */
export async function downloadBranch(
  input: RepoRef & { branch?: string | undefined },
  token: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<{ source: RepoSource; zip: Uint8Array }> {
  const { owner, repo } = input;
  const meta = await getJson<{ default_branch: string; private: boolean; size: number; html_url: string }>(fetcher, `${API}/repos/${owner}/${repo}`, token, "repoet");
  if (meta.size > MAX_REPO_KB) {
    throw new GitHubImportError(`Repoet er for stort (${Math.round(meta.size / 1000)} MB, maks ${MAX_REPO_KB / 1000} MB).`, 413);
  }
  const branch = input.branch || meta.default_branch;
  const commit = await getJson<{ sha: string }>(fetcher, `${API}/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, token, `grenen «${branch}»`);

  let response: Response;
  try {
    // The commit sha is used rather than the branch name, so what is read is exactly what the pull request will be based on.
    response = await fetcher(`${API}/repos/${owner}/${repo}/zipball/${commit.sha}`, { headers: headers(token), redirect: "follow", signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new GitHubImportError("Fikk ikke lastet ned repoet fra GitHub.", 502);
  }
  if (!response.ok) throw explain(response.status, Boolean(token), "arkivet");
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_ARCHIVE_BYTES) throw new GitHubImportError(`Arkivet er for stort (maks ${MAX_ARCHIVE_BYTES / 1_000_000} MB).`, 413);
  const zip = new Uint8Array(await response.arrayBuffer());
  if (zip.length > MAX_ARCHIVE_BYTES) throw new GitHubImportError(`Arkivet er for stort (maks ${MAX_ARCHIVE_BYTES / 1_000_000} MB).`, 413);

  return { source: { owner, repo, branch, sha: commit.sha, private: meta.private, url: meta.html_url }, zip };
}

/**
 * The same as `downloadBranch`, for importing: the archive is read as it arrives and only what could be kept
 * is held (see thin.ts), so a repository full of pictures, sound and dependencies is no longer refused for its size.
 */
export async function downloadBranchThin(
  input: RepoRef & { branch?: string | undefined },
  token: string | undefined,
  fileBytes: number,
  fetcher: Fetcher = fetch,
): Promise<{ source: RepoSource; thin: Thin }> {
  const { owner, repo } = input;
  const meta = await getJson<{ default_branch: string; private: boolean; size: number; html_url: string }>(fetcher, `${API}/repos/${owner}/${repo}`, token, "repoet");
  if (meta.size > THIN_LIMITS.repoKb) {
    throw new GitHubImportError(`Repoet er for stort (${Math.round(meta.size / 1000)} MB, maks ${THIN_LIMITS.repoKb / 1000} MB).`, 413);
  }
  const branch = input.branch || meta.default_branch;
  const commit = await getJson<{ sha: string }>(fetcher, `${API}/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, token, `grenen «${branch}»`);
  let response: Response;
  try {
    response = await fetcher(`${API}/repos/${owner}/${repo}/zipball/${commit.sha}`, { headers: headers(token), redirect: "follow", signal: AbortSignal.timeout(THIN_LIMITS.ms) });
  } catch {
    throw new GitHubImportError("Fikk ikke lastet ned repoet fra GitHub.", 502);
  }
  if (!response.ok) throw explain(response.status, Boolean(token), "arkivet");
  if (!response.body) throw new GitHubImportError("GitHub sendte ikke noe innhold.", 502);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > THIN_LIMITS.downloadBytes) throw new GitHubImportError(`Arkivet er for stort (maks ${THIN_LIMITS.downloadBytes / 1_000_000} MB).`, 413);
  const thin = await thinArchive(response.body, { fileBytes });
  return { source: { owner, repo, branch, sha: commit.sha, private: meta.private, url: meta.html_url }, thin };
}

/**
 * Whether anyone can read the repository without a key. Asked without the token, so the answer is what the
 * outside world sees. A public repository can be cloned inside the isolated machine without any credential
 * there, whatever its size.
 */
export async function isPublicRepo(ref: RepoRef, fetcher: Fetcher = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${API}/repos/${ref.owner}/${ref.repo}`, { headers: headers(undefined), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const meta = (await response.json()) as { private?: boolean };
    return meta.private === false;
  } catch {
    return false;
  }
}

/** What a GitHub import keeps: code and small text, with bulk data left in the repository. */
export const GITHUB_READ_OPTIONS = { fileBytes: 150_000, textBytes: 1_500_000, skipOverflow: true } as const;
