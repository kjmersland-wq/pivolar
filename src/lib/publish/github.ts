const API = "https://api.github.com";

/** Text is sent as UTF-8; `{ base64 }` is a binary file such as a PNG. */
export type PublishFile = string | { base64: string };

type Options = {
  token: string;
  /** Owner of the repository; defaults to the user the token belongs to. */
  owner?: string | undefined;
  repo: string;
  files: Record<string, PublishFile>;
  message: string;
  isPrivate: boolean;
};

export type GitHubResult = { owner: string; repo: string; url: string; commitUrl: string; created: boolean; /** Set when GitHub refused the CI workflow because the token may not edit workflows. */ workflowSkipped?: boolean };

class GitHubError extends Error {}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

function explain(status: number, data: unknown): string {
  const message = (data as { message?: string })?.message ?? "";
  if (status === 401) return "GitHub avviste nøkkelen (GITHUB_TOKEN). Lag en ny og sjekk at den ikke er utløpt.";
  if (status === 403) return `GitHub nektet tilgang. Nøkkelen trenger skrivetilgang til innhold og lov til å opprette repoer. ${message}`.trim();
  if (status === 404) return "GitHub fant ikke repoet eller kontoen. Sjekk GITHUB_OWNER og at nøkkelen har tilgang.";
  if (status === 422) return `GitHub avviste forespørselen: ${message}`;
  return `GitHub svarte ${status}. ${message}`.trim();
}

/**
 * Creates the repository if it does not exist and puts all files in a single commit on `main`.
 * Publishing again updates the same repository with a new commit.
 */
export async function publishToGitHub({ token, owner, repo, files, message, isPrivate }: Options): Promise<GitHubResult> {
  const me = await call<{ login?: string }>(token, "/user");
  if (me.status !== 200 || !me.data.login) throw new GitHubError(explain(me.status, me.data));
  const login = owner || me.data.login;

  let created = false;
  const existing = await call(token, `/repos/${login}/${repo}`);
  if (existing.status === 404) {
    const path = login === me.data.login ? "/user/repos" : `/orgs/${login}/repos`;
    const make = await call(token, path, {
      method: "POST",
      body: JSON.stringify({ name: repo, private: isPrivate, auto_init: true, description: "Bygget med Pivolar" }),
    });
    if (make.status !== 201) throw new GitHubError(explain(make.status, make.data));
    created = true;
    // GitHub needs a moment before a brand-new repository accepts Git data calls.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } else if (existing.status !== 200) {
    throw new GitHubError(explain(existing.status, existing.data));
  }

  const base = `/repos/${login}/${repo}`;
  const ref = await call<{ object?: { sha: string } }>(token, `${base}/git/ref/heads/main`);
  if (ref.status !== 200 || !ref.data.object) throw new GitHubError("Repoet har ingen main-gren å bygge videre på.");
  const parentSha = ref.data.object.sha;

  const parent = await call<{ tree?: { sha: string } }>(token, `${base}/git/commits/${parentSha}`);
  if (parent.status !== 200 || !parent.data.tree) throw new GitHubError(explain(parent.status, parent.data));

  // Text files are sent inline in the tree call. Binary files need a blob of their own first.
  const entries: { path: string; mode: string; type: string; content?: string; sha?: string }[] = [];
  for (const [path, file] of Object.entries(files)) {
    if (typeof file === "string") {
      entries.push({ path, mode: "100644", type: "blob", content: file });
      continue;
    }
    const blob = await call<{ sha?: string }>(token, `${base}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: file.base64, encoding: "base64" }),
    });
    if (blob.status !== 201 || !blob.data.sha) throw new GitHubError(explain(blob.status, blob.data));
    entries.push({ path, mode: "100644", type: "blob", sha: blob.data.sha });
  }
  const makeTree = (list: typeof entries) =>
    call<{ sha?: string }>(token, `${base}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: parent.data.tree!.sha, tree: list }),
    });
  let tree = await makeTree(entries);
  // A token without the "workflow" permission cannot add .github/workflows files. The site is still published, without CI.
  let workflowSkipped = false;
  const withoutWorkflows = entries.filter((entry) => !entry.path.startsWith(".github/workflows/"));
  if ((tree.status !== 201 || !tree.data.sha) && withoutWorkflows.length < entries.length) {
    tree = await makeTree(withoutWorkflows);
    workflowSkipped = tree.status === 201;
  }
  if (tree.status !== 201 || !tree.data.sha) throw new GitHubError(explain(tree.status, tree.data));

  const commit = await call<{ sha?: string; html_url?: string }>(token, `${base}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.data.sha, parents: [parentSha] }),
  });
  if (commit.status !== 201 || !commit.data.sha) throw new GitHubError(explain(commit.status, commit.data));

  const move = await call(token, `${base}/git/refs/heads/main`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.data.sha }),
  });
  if (move.status !== 200) throw new GitHubError(explain(move.status, move.data));

  return {
    owner: login,
    repo,
    url: `https://github.com/${login}/${repo}`,
    commitUrl: commit.data.html_url ?? `https://github.com/${login}/${repo}/commit/${commit.data.sha}`,
    created,
    ...(workflowSkipped ? { workflowSkipped } : {}),
  };
}
