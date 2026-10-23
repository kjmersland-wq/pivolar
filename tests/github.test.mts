import assert from "node:assert/strict";
import { downloadBranch, GITHUB_READ_OPTIONS, GitHubImportError, listBranches, MAX_REPO_KB, parseRepoInput } from "../src/lib/github/repo.ts";
import { readZip } from "../src/lib/zip/read.ts";

// --- addresses
assert.deepEqual(parseRepoInput("https://github.com/kjmersland-wq/vibe7music"), { owner: "kjmersland-wq", repo: "vibe7music" });
assert.deepEqual(parseRepoInput("github.com/a/b.git"), { owner: "a", repo: "b" });
assert.deepEqual(parseRepoInput("a/b"), { owner: "a", repo: "b" });
assert.deepEqual(parseRepoInput("git@github.com:a/b.git"), { owner: "a", repo: "b" });
assert.deepEqual(parseRepoInput("https://github.com/a/b/tree/feature/x"), { owner: "a", repo: "b", branch: "feature/x" });
assert.equal(parseRepoInput("https://gitlab.com/a/b"), null);
assert.equal(parseRepoInput("https://github.com.evil.com/a/b"), null);
assert.equal(parseRepoInput("not a repo"), null);
assert.equal(parseRepoInput("a/b c"), null);
assert.equal(parseRepoInput("../etc/passwd"), null);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// --- branches: default first
{
  const calls: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push(url);
    assert.ok(!(init?.headers as Record<string, string>)?.Authorization, "no token, no auth header");
    return url.endsWith("/branches?per_page=100") ? json([{ name: "dev" }, { name: "main" }]) : json({ default_branch: "main", private: false });
  };
  const out = await listBranches({ owner: "a", repo: "b" }, undefined, fetcher);
  assert.deepEqual(out, { defaultBranch: "main", branches: ["main", "dev"], private: false });
}

// --- errors say what to do
{
  const missing = async () => json({}, 404);
  await assert.rejects(listBranches({ owner: "a", repo: "b" }, undefined, missing), (e: GitHubImportError) => e.status === 404 && /GITHUB_TOKEN/.test(e.message));
  await assert.rejects(listBranches({ owner: "a", repo: "b" }, "tok", missing), (e: GitHubImportError) => /har tilgang til repoet/.test(e.message));
  await assert.rejects(listBranches({ owner: "a", repo: "b" }, "tok", async () => json({}, 401)), (e: GitHubImportError) => e.status === 401);
  await assert.rejects(listBranches({ owner: "a", repo: "b" }, undefined, async () => json({}, 403)), (e: GitHubImportError) => e.status === 429);
  await assert.rejects(listBranches({ owner: "a", repo: "b" }, undefined, async () => { throw new Error("offline"); }), (e: GitHubImportError) => e.status === 502);
}

// --- download: pins the commit and refuses huge repos
{
  const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
  const urls: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url.includes("/commits/")) return json({ sha: "abc123" });
    if (url.includes("/zipball/")) {
      assert.equal(init?.redirect, "follow");
      return new Response(zip);
    }
    return json({ default_branch: "main", private: true, size: 2000, html_url: "https://github.com/a/b" });
  };
  const out = await downloadBranch({ owner: "a", repo: "b" }, "tok", fetcher);
  assert.equal(out.source.sha, "abc123");
  assert.equal(out.source.branch, "main");
  assert.equal(out.source.private, true);
  assert.ok(urls.at(-1)!.endsWith("/zipball/abc123"), "downloads the exact commit");
  assert.ok(urls.some((u) => u.endsWith("/commits/feature%2Fx")) === false);
  await downloadBranch({ owner: "a", repo: "b", branch: "feature/x" }, undefined, fetcher);
  assert.ok(urls.some((u) => u.endsWith("/commits/feature%2Fx")), "branch names are encoded");
  const huge = async () => json({ default_branch: "main", private: false, size: MAX_REPO_KB + 1, html_url: "" });
  await assert.rejects(downloadBranch({ owner: "a", repo: "b" }, undefined, huge), (e: GitHubImportError) => e.status === 413);
  const bigArchive = async (url: string) => (url.includes("/commits/") ? json({ sha: "x" }) : url.includes("/zipball/") ? new Response(zip, { headers: { "content-length": "99999999" } }) : json({ default_branch: "main", private: false, size: 1, html_url: "" }));
  await assert.rejects(downloadBranch({ owner: "a", repo: "b" }, undefined, bigArchive), (e: GitHubImportError) => e.status === 413);
}

// --- read options: big data files stay in the repo, code is kept
assert.ok(GITHUB_READ_OPTIONS.skipOverflow && GITHUB_READ_OPTIONS.fileBytes < 1_000_000);
assert.throws(() => readZip(new Uint8Array(0), GITHUB_READ_OPTIONS), /tom/);

console.log("github: all ok");
