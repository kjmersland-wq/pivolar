import assert from "node:assert/strict";
import { INDEX_THRESHOLD, INLINE_BUDGET, READ_MAX_LINES, SEARCH_MAX_HITS, buildIndex, readFile, recentPaths, searchFiles, shouldIndex } from "../src/lib/context/index.ts";

const big = (n: number) => "x".repeat(n);
const small = { "/App.tsx": "export default function App() { return null; }", "/styles.css": ":root { --a: 1; }" };

// --- small projects are sent in full, as before
assert.equal(shouldIndex(small), false);

// --- big projects use the index; the sandbox's protected files do not count
{
  const files = { ...small, "/index.tsx": big(INDEX_THRESHOLD + 10), "/atelier-inspector.js": big(INDEX_THRESHOLD) };
  assert.equal(shouldIndex(files), false, "protected files are not the user's project");
  const project = { ...small, "/components/Big.tsx": big(INDEX_THRESHOLD + 1) };
  assert.equal(shouldIndex(project), true);
}

// --- the map lists every file with size, lines and exports
{
  const files = {
    "/App.tsx": "import X from './X';\nexport default function App() {\n  return null;\n}\n",
    "/components/Hero.tsx": "export function Hero() {}\nexport const Title = 1;\nexport type Props = {};\n",
    "/styles.css": ":root {\n  --bg: #111;\n  --fg: #eee;\n}\n.card { color: red; }\n",
    "/data.json": '{"a":1}',
    "/index.tsx": "protected",
  };
  const index = buildIndex(files, ["/components/Hero.tsx"]);
  assert.match(index.map, /^\/App\.tsx {2}\(5 linjer, \d+ tegn\) – default-eksport|exporterer App/m);
  assert.match(index.map, /\/components\/Hero\.tsx {2}\(4 linjer.*exporterer Hero, Title, Props/);
  assert.match(index.map, /\/styles\.css.*2 variabler; klasser \.card/);
  assert.doesNotMatch(index.map, /index\.tsx/, "protected files are not listed");
  assert.deepEqual(index.inlined.slice(0, 1), ["/components/Hero.tsx"], "recent files come first");
  assert.ok(index.inlined.includes("/App.tsx") && index.inlined.includes("/styles.css"), "small essentials are included");
  assert.match(index.map, /Hero\.tsx.*\[i fulltekst under\]/);
}

// --- the inline budget is respected, recent files first
{
  const files: Record<string, string> = { "/App.tsx": "x" };
  for (let i = 0; i < 6; i++) files[`/components/C${i}.tsx`] = big(12_000);
  const recent = ["/components/C5.tsx", "/components/C4.tsx", "/components/C3.tsx", "/components/C2.tsx"];
  const index = buildIndex(files, recent);
  const used = index.inlined.reduce((sum, p) => sum + files[p]!.length, 0);
  assert.ok(used <= INLINE_BUDGET, `inlined ${used} chars, budget ${INLINE_BUDGET}`);
  assert.deepEqual(index.inlined.filter((p) => p.startsWith("/components")), ["/components/C5.tsx", "/components/C4.tsx"]);
  assert.ok(index.omitted.includes("/components/C0.tsx"));
  // a big essential file is not sent in full
  assert.ok(!buildIndex({ "/App.tsx": big(9000) }).inlined.includes("/App.tsx"));
}

// --- readFile returns the exact text, line ranges and helpful errors
{
  const files = { "/a.tsx": "one\ntwo\nthree\nfour\nfive", "/components/Header.tsx": "x" };
  const all = readFile(files, { path: "/a.tsx" });
  assert.equal(all.ok, true);
  assert.equal(all.content, "one\ntwo\nthree\nfour\nfive", "exact, so editFile can match it");
  assert.equal(all.totalLines, 5);
  const part = readFile(files, { path: "a.tsx", from: 2, to: 3 });
  assert.equal(part.content, "two\nthree", "a missing leading slash is accepted");
  assert.match(part.message, /linje 2–3 av 5/);
  assert.equal(readFile(files, { path: "/a.tsx", from: 9 }).ok, false);
  const missing = readFile(files, { path: "/Header.tsx" });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /Mente du \/components\/Header\.tsx/);
  assert.equal(readFile({ "/index.tsx": "secret" }, { path: "/index.tsx" }).ok, false, "protected files cannot be read");
  const long = readFile({ "/long.txt": Array.from({ length: READ_MAX_LINES + 50 }, (_, i) => `l${i}`).join("\n") }, { path: "/long.txt" });
  assert.match(long.message, /kortet ned.*from: 601/);
  assert.equal(long.to, READ_MAX_LINES);
}

// --- searchFiles
{
  const files = {
    "/App.tsx": "import { Hero } from './components/Hero';\nconst a = 1;",
    "/components/Hero.tsx": "export function Hero() {\n  return <h1 className=\"title\">Hello (world)</h1>;\n}",
    "/styles.css": ".title { color: red; }",
    "/index.tsx": "Hero protected",
  };
  const r = searchFiles(files, { query: "hero" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.hits.map((h) => `${h.path}:${h.line}`), ["/App.tsx:1", "/components/Hero.tsx:1"], "any case, sorted by path, protected files skipped");
  assert.equal(searchFiles(files, { query: "(world)" }).hits.length, 1, "plain text: special characters are literal");
  assert.equal(searchFiles(files, { query: "class\\w+=", regex: true }).hits.length, 1);
  assert.equal(searchFiles(files, { query: "(", regex: true }).ok, false, "a broken pattern is reported, not thrown");
  assert.equal(searchFiles(files, { query: "title", path: "/styles.css" }).hits.length, 1, "restricted to a path");
  assert.equal(searchFiles(files, { query: "nothing here" }).message, "Ingen treff.");
  const many = { "/m.txt": Array.from({ length: 100 }, () => "needle").join("\n") };
  const capped = searchFiles(many, { query: "needle" });
  assert.equal(capped.hits.length, SEARCH_MAX_HITS);
  assert.match(capped.message, /100 treff.*viser de 40 første/);
}

// --- recentPaths: newest first, failed writes ignored, no duplicates
{
  const tool = (type: string, path: string, ok = true) => ({ type, state: "output-available", input: { path }, output: { ok } });
  const messages = [
    { role: "user", parts: [] },
    { role: "assistant", parts: [tool("tool-writeFile", "/a.tsx"), tool("tool-writeFile", "/b.tsx")] },
    { role: "user", parts: [] },
    { role: "assistant", parts: [tool("tool-editFile", "/a.tsx"), tool("tool-editFile", "/c.tsx", false), tool("tool-searchImages", "/x")] },
  ];
  assert.deepEqual(recentPaths(messages), ["/a.tsx", "/b.tsx"]);
}

console.log("context: all ok");
