import assert from "node:assert/strict";
import { condenseSpec, type Spec } from "../src/lib/analyze/condense.ts";
import { assertPublicUrl, AnalyzeError, isPublicHost, isPublicIp } from "../src/lib/analyze/guard.ts";
import { MAX_ANALYSES_PER_REQUEST, createAnalyzeTool, trimOldAnalyses, type AnalyzeOutput } from "../src/lib/analyze/tool.ts";

// --- isPublicIp: private, loopback, link-local and metadata addresses are never allowed
for (const bad of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip", "999.1.1.1"]) {
  assert.equal(isPublicIp(bad), false, bad);
}
for (const good of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicIp(good), true, good);

// --- isPublicHost resolves names and requires every address to be public
const resolver = (map: Record<string, string[]>) => async (host: string) => {
  if (!map[host]) throw new Error("ENOTFOUND");
  return map[host]!.map((address) => ({ address }));
};
assert.equal(await isPublicHost("example.com", resolver({ "example.com": ["93.184.216.34"] })), true);
assert.equal(await isPublicHost("evil-1.test", resolver({ "evil-1.test": ["93.184.216.34", "10.0.0.5"] })), false, "one private address is enough to refuse");
assert.equal(await isPublicHost("rebind.test", resolver({ "rebind.test": ["169.254.169.254"] })), false, "metadata address behind a public name");
assert.equal(await isPublicHost("missing.test", resolver({})), false, "unresolvable names are refused");
assert.equal(await isPublicHost("localhost", resolver({ localhost: ["8.8.8.8"] })), false, "reserved names are refused before any lookup");
assert.equal(await isPublicHost("db.internal", resolver({ "db.internal": ["8.8.8.8"] })), false);
assert.equal(await isPublicHost("192.168.0.10"), false, "IP literals are checked directly");
assert.equal(await isPublicHost("[::1]"), false);

// --- assertPublicUrl
const ok = resolver({ "www.example.com": ["93.184.216.34"], "intra.example.com": ["10.0.0.9"] });
assert.equal((await assertPublicUrl("www.example.com/path?x=1", ok)).toString(), "https://www.example.com/path?x=1", "a bare host gets https");
assert.equal((await assertPublicUrl("http://www.example.com:80/", ok)).protocol, "http:");
for (const [input, why] of [
  ["file:///etc/passwd", "file scheme"],
  ["ftp://www.example.com/", "ftp"],
  ["javascript:alert(1)", "javascript scheme"],
  ["https://user:pw@www.example.com/", "credentials in the address"],
  ["https://www.example.com:8080/", "non-standard port"],
  ["https://intra.example.com/", "name that resolves to a private address"],
  ["http://127.0.0.1/", "loopback"],
  ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
  ["", "empty"],
  ["http://", "no host"],
] as const) {
  await assert.rejects(() => assertPublicUrl(input, ok), (e) => e instanceof AnalyzeError, why);
}

// --- condenseSpec: nothing changes when it fits, and big specs shrink step by step
const block = (i: number, extra: Record<string, unknown> = {}) => ({ k: i % 5 === 0 ? "svg" : "p", t: "Tekst ".repeat(40), y: i * 20, x: 20, w: 400, h: 20, nw: 100, nh: 100, ...extra });
const big: Spec = {
  url: "https://x.test/",
  vw: 1280,
  vh: 800,
  docH: 9000,
  title: "T",
  lang: "nb",
  fonts: ["Inter 400/600"],
  vars: { "--bg": "#111111" },
  body: { bg: "#111111", color: "#eeeeee", ff: "Inter", fs: 16, lh: "24px" },
  sections: Array.from({ length: 10 }, (_, i) => ({ i, tag: "section", id: "", top: i * 900, h: 900, pt: 96, pb: 96, bg: null, blocks: Array.from({ length: 80 }, (_, j) => block(j)), boxes: [{ y: 100, n: 3 }] })),
};
{
  const small = condenseSpec({ ...big, sections: big.sections.slice(0, 1).map((s) => ({ ...s, blocks: s.blocks.slice(0, 3) })) }, 32_000);
  assert.deepEqual(small.steps, [], "a spec that fits is left alone");
  const c = condenseSpec(big, 32_000);
  assert.ok(c.json.length <= 32_000 || c.steps.length === 6, "shrinks until it fits, or all steps are used");
  assert.ok(c.steps.length >= 3, "several steps were needed");
  const parsed = JSON.parse(c.json) as Spec;
  assert.equal(parsed.sections.length, 10, "every section is kept");
  assert.deepEqual(parsed.sections.map((s) => [s.top, s.h]), big.sections.map((s) => [s.top, s.h]), "section tops and heights survive");
  assert.ok(parsed.sections.every((s) => s.blocks.every((b) => b.k !== "svg")), "icons go first");
  assert.ok(parsed.sections[0]!.more! > 0, "it says how many blocks were dropped");
  assert.equal(big.sections[0]!.blocks.length, 80, "the input is not modified");
}

// --- the tool
const spec: Spec = { ...big, sections: big.sections.slice(0, 2).map((s) => ({ ...s, blocks: s.blocks.slice(0, 6) })) };
const analyzeOk = async (url: string) => ({ spec: { ...spec, url }, shots: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])], finalUrl: url });
{
  const uploads: string[] = [];
  const tool = createAnalyzeTool({
    userId: "user-1",
    analyze: analyzeOk as never,
    newId: (() => { let n = 0; return () => `id-${++n}`; })(),
    upload: async ({ path }) => (uploads.push(path), `https://s.test/${path}`),
    fetcher: async () => new Response(new Uint8Array([9, 9, 9])),
  });
  const out = await tool.execute({ url: "https://ref.test/" });
  assert.equal(out.ok, true);
  assert.deepEqual(uploads, ["user-1/refs/id-1.jpg", "user-1/refs/id-2.jpg"], "screenshots go in the user's own folder");
  assert.equal(out.shots!.length, 2);
  assert.equal(out.spec!.sections.length, 2, "the stored output keeps the whole spec");

  const forModel = (await tool.toModelOutput({ output: out })) as { type: string; value: { type: string }[] };
  assert.equal(forModel.type, "content");
  assert.equal(forModel.value[0]!.type, "text");
  assert.match((forModel.value[0] as unknown as { text: string }).text, /1280 px bredde/);
  assert.equal(forModel.value.filter((p) => p.type === "file").length, 2, "both screenshots reach the model");

  // limit per request
  const second = await tool.execute({ url: "https://ref.test/2" });
  assert.equal(second.ok, true);
  const third = await tool.execute({ url: "https://ref.test/3" });
  assert.equal(third.ok, false);
  assert.match(third.message, new RegExp(`${MAX_ANALYSES_PER_REQUEST} analyser`));
}
{
  // a failed upload costs a screenshot, not the analysis
  const tool = createAnalyzeTool({ userId: "u", analyze: analyzeOk as never, upload: async () => { throw new Error("storage down"); } });
  const out = await tool.execute({ url: "https://ref.test/" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.shots, []);
}
{
  // errors become messages for the user, and nothing internal leaks
  const refused = createAnalyzeTool({ userId: "u", upload: async () => "", analyze: (async () => { throw new AnalyzeError("Adressen peker ikke til et offentlig nettsted."); }) as never });
  assert.match((await refused.execute({ url: "http://10.0.0.1" })).message, /offentlig/);
  const crashed = createAnalyzeTool({ userId: "u", upload: async () => "", analyze: (async () => { throw new Error("secret path C:\\internal\\thing"); }) as never });
  const result = await crashed.execute({ url: "https://x.test" });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message, /internal|secret/);
  assert.equal(((await refused.toModelOutput({ output: { ok: false, message: "feil" } })) as { type: string }).type, "text");
}

// --- trimOldAnalyses
const part = (n: number): { type: string; state: string; output: AnalyzeOutput } => ({ type: "tool-analyzeSite", state: "output-available", output: { ok: true, message: `m${n}`, spec, shots: ["https://s.test/a.jpg"] } });
const msg = (role: string, ...parts: unknown[]) => ({ role, parts });
{
  assert.deepEqual(trimOldAnalyses([msg("user", { type: "text" })]), [msg("user", { type: "text" })], "no analysis, no change");
  const messages = [msg("user"), msg("assistant", part(1)), msg("user"), msg("assistant", part(2)), msg("user")];
  const trimmed = trimOldAnalyses(messages) as { role: string; parts: { output?: AnalyzeOutput }[] }[];
  assert.equal(trimmed[1]!.parts[0]!.output!.spec, undefined, "the older analysis is reduced to a note");
  assert.match(trimmed[1]!.parts[0]!.output!.message, /utelatt/);
  assert.ok(trimmed[3]!.parts[0]!.output!.spec, "the newest analysis keeps its numbers");
  assert.equal(trimmed[3]!.parts[0]!.output!.shots!.length, 1, "and its screenshots while the conversation is young");
  assert.ok((messages[1] as { parts: { output: AnalyzeOutput }[] }).parts[0]!.output.spec, "the input is not modified");
  const old = [msg("assistant", part(1)), ...Array.from({ length: 12 }, () => msg("user"))];
  const later = trimOldAnalyses(old) as { parts: { output?: AnalyzeOutput }[] }[];
  assert.deepEqual(later[0]!.parts[0]!.output!.shots, [], "screenshots are dropped once the conversation has moved on");
  assert.ok(later[0]!.parts[0]!.output!.spec, "the numbers stay");
}

console.log("analyze: all ok");
