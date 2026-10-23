import assert from "node:assert/strict";
import { TEMPLATE } from "../src/lib/files.ts";
import { countChanges, diffImport } from "../src/lib/github/changes.ts";
import { branchName, openPullRequest } from "../src/lib/github/pr.ts";
import { GitHubImportError } from "../src/lib/github/repo.ts";

// --- diff: only real changes, never the starter template
{
  const baseline = { "/src/App.tsx": "old", "/src/keep.ts": "same", "/src/gone.ts": "x" };
  const current = { ...TEMPLATE, "/src/App.tsx": "new", "/src/keep.ts": "same", "/src/added.ts": "fresh" };
  const d = diffImport(baseline, current);
  assert.deepEqual(d.write, { "/src/App.tsx": "new", "/src/added.ts": "fresh" });
  assert.deepEqual(d.remove, ["/src/gone.ts"]);
  assert.equal(countChanges(d), 3);
  assert.ok(!("/App.tsx" in d.write) && !("/styles.css" in d.write), "untouched template files are not part of the repo");
  assert.ok(!("/index.tsx" in d.write) && !("/atelier-inspector.js" in d.write));
  assert.equal(countChanges(diffImport(baseline, { ...TEMPLATE, ...baseline })), 0);
  assert.deepEqual(diffImport({}, { ...TEMPLATE, "/App.tsx": "edited" }).write, { "/App.tsx": "edited" }, "a template file that was changed counts");
}

// --- branch names
{
  const at = new Date("2026-10-23T16:45:00Z");
  assert.equal(branchName("Endre hero-seksjonen på forsiden", at), "pivolar/endre-hero-seksjonen-pa-forsiden-202610231645");
  assert.equal(branchName("!!!", at), "pivolar/endringer-202610231645");
  assert.match(branchName("Æ Ø Å", at), /^pivolar\/ae-o-a-/);
}

// --- pull request: new branch from the imported commit, base branch untouched
{
  const sha = "a".repeat(40);
  const log: { method: string; path: string; body?: any }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const path = url.replace("https://api.github.com/repos/o/r", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    log.push({ method, path, body });
    assert.match((init?.headers as Record<string, string>).Authorization!, /^Bearer tok$/);
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (path === `/git/commits/${sha}`) return reply({ tree: { sha: "tree0" } });
    if (path === "/git/trees") return reply({ sha: "tree1" }, 201);
    if (path === "/git/commits") return reply({ sha: "commit1", html_url: "https://github.com/o/r/commit/commit1" }, 201);
    if (path === "/git/refs") return reply({}, 201);
    if (path === "/pulls") return reply({ html_url: "https://github.com/o/r/pull/7", number: 7 }, 201);
    return reply({}, 500);
  };
  const input = { owner: "o", repo: "r", baseBranch: "main", baseSha: sha, write: { "/src/App.tsx": "new" }, remove: ["/src/gone.ts"], title: "Ny hero", body: "Fra Pivolar" };
  const out = await openPullRequest("tok", input, fetcher, new Date("2026-10-23T16:45:00Z"));
  assert.equal(out.url, "https://github.com/o/r/pull/7");
  assert.equal(out.number, 7);
  assert.equal(out.branch, "pivolar/ny-hero-202610231645");
  const tree = log.find((l) => l.path === "/git/trees")!.body;
  assert.equal(tree.base_tree, "tree0");
  assert.deepEqual(tree.tree, [
    { path: "src/App.tsx", mode: "100644", type: "blob", content: "new" },
    { path: "src/gone.ts", mode: "100644", type: "blob", sha: null },
  ]);
  assert.deepEqual(log.find((l) => l.path === "/git/commits")!.body.parents, [sha], "the commit is based on what was imported");
  assert.equal(log.find((l) => l.path === "/git/refs")!.body.ref, "refs/heads/pivolar/ny-hero-202610231645");
  assert.equal(log.find((l) => l.path === "/pulls")!.body.base, "main");
  const writesToBase = log.filter((l) => l.method !== "GET" && (l.path.includes("heads/main") || l.body?.ref === "refs/heads/main"));
  assert.equal(writesToBase.length, 0, "the imported branch is never written to");

  const reject = (status: number) => async (url: string) => (url.endsWith(`/git/commits/${sha}`) ? new Response(JSON.stringify({ message: "nope" }), { status }) : new Response("{}", { status: 500 }));
  await assert.rejects(openPullRequest("tok", input, reject(404)), (e: GitHubImportError) => e.status === 403 && /Pull requests/.test(e.message));
  await assert.rejects(openPullRequest("tok", input, reject(401)), (e: GitHubImportError) => e.status === 401);
  await assert.rejects(openPullRequest("tok", { ...input, baseSha: "short" }, fetcher), /commit/);
  await assert.rejects(openPullRequest("tok", { ...input, write: {}, remove: [] }, fetcher), /Ingen endringer/);
  await assert.rejects(openPullRequest("tok", { ...input, baseBranch: "main; rm -rf" }, fetcher), /Ugyldig gren/);
}

console.log("github-pr: all ok");
