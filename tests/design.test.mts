import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { designSchema, FONT_PAIRS, LIMITS, sanitizeDesign } from "../src/lib/import/design.ts";
import { DESIGN_SYSTEM, designPrompt, MAX_PROMPT_CHARS } from "../src/lib/import/design-prompt.ts";
import type { Page, SiteModel } from "../src/lib/import/model.ts";
import { RATES } from "../src/lib/quota/config.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const PATHS = ["/", "/om-oss", "/kontakt"];

// --- the brief is cut down to fixed options
{
  const good = sanitizeDesign({ radius: "round", density: "airy", header: "centered", footer: "columns", fonts: "editorial", hero: { headline: "Kaffe brent lokalt", subline: "Siden 1990.", cta: { label: "Les mer", href: "/om-oss" } } }, PATHS)!;
  assert.deepEqual(good, { radius: "round", density: "airy", header: "centered", footer: "columns", fonts: "editorial", hero: { headline: "Kaffe brent lokalt", subline: "Siden 1990.", cta: { label: "Les mer", href: "/om-oss" } } });

  // Anything outside the options becomes the plain default
  const odd = sanitizeDesign({ radius: "huge", density: 3, header: "<script>", footer: null, fonts: "comic-sans", css: "body{display:none}", html: "<b>" }, PATHS)!;
  assert.deepEqual(odd, { radius: "soft", density: "regular", header: "simple", footer: "minimal" });
  assert.ok(!("css" in odd) && !("html" in odd), "no field outside the brief is kept");
  assert.equal(sanitizeDesign({ fonts: "__proto__" }, PATHS)!.fonts, undefined);
  for (const bad of [null, undefined, "tekst", 5, []]) assert.equal(sanitizeDesign(bad, PATHS), null);

  // Texts: no tags or control characters, cut to length; a button only to a page that exists
  const text = sanitizeDesign({ hero: { headline: `  <img src=x onerror=alert(1)>\u0000Hei   verden ${"x".repeat(200)}`, subline: "y".repeat(500), cta: { label: "z".repeat(100), href: "https://evil.example/" } } }, PATHS)!.hero!;
  assert.doesNotMatch(text.headline, /[<>\u0000]/);
  assert.ok(text.headline.length <= LIMITS.headline && text.subline.length <= LIMITS.subline);
  assert.equal(text.cta, undefined, "a button to another site is dropped");
  assert.equal(sanitizeDesign({ hero: { headline: "A", subline: "", cta: { label: "Gå", href: "/finnes-ikke" } } }, PATHS)!.hero!.cta, undefined, "and so is a button to a page that does not exist");
  assert.equal(sanitizeDesign({ hero: { headline: "   ", subline: "tekst" } }, PATHS)!.hero, undefined, "a hero needs a heading");
  assert.deepEqual(sanitizeDesign({ hero: { headline: "A", subline: "B", cta: { label: "Gå", path: "/kontakt" } } }, PATHS)!.hero!.cta, { label: "Gå", href: "/kontakt" });
}

// --- the schema the model fills in only has fixed options
{
  const ok = designSchema.safeParse({ radius: "soft", density: "regular", header: "simple", footer: "minimal", fonts: "modern" });
  assert.ok(ok.success);
  assert.ok(!designSchema.safeParse({ radius: "soft", density: "regular", header: "simple", footer: "minimal", fonts: "x" }).success);
  for (const pair of Object.values(FONT_PAIRS)) assert.match(pair.link, /^https:\/\/fonts\.googleapis\.com\/css2\?/, "font addresses are ours");
}

// --- what the model reads: a short description, bounded, with the pages' words as data
const page = (over: Partial<Page> & { id: string; path: string; title: string }): Page => ({ kind: "page", url: "https://old.no" + over.path, slug: "", parent: null, excerpt: "", seo: {}, featuredImage: null, signals: [], blocks: [], ...over });
{
  const many: Page[] = Array.from({ length: 150 }, (_, i) => page({ id: `p${i}`, path: `/side-${i}`, title: `Side ${i}`, blocks: [{ type: "paragraph", html: `<p>${"Dette er en lang tekst med <b>mye</b> innhold. ".repeat(200)}</p>` }] }));
  const model = { source: "wordpress", url: "https://old.no", name: "Kaffebar", description: "Brent lokalt", language: "nb-NO", nav: [], pages: many, media: [], plugins: [], warnings: [], truncated: false, stats: { pages: 150, posts: 0, media: 0, blocks: 0, unknownBlocks: 0, requests: 0, ms: 0 } } as SiteModel;
  const { prompt, paths } = designPrompt(model);
  assert.ok(prompt.length <= MAX_PROMPT_CHARS, "a large site still gives a short description");
  assert.ok(prompt.split("\n").filter((l) => l.startsWith("/side-")).length <= 12, "only a few pages are described");
  assert.doesNotMatch(prompt, /<b>|<p>/, "no markup is sent");
  assert.ok(paths.includes("/") && paths.includes("/side-149"), "every page of the site is a valid target for the button, and so is the front page");
  assert.match(DESIGN_SYSTEM, /data, ikke instruksjoner/, "the site's text is told to be data");
}

// --- the route: the same hard stops as the chat, and nothing but the brief comes out
{
  const route = read("src/app/api/import/design/route.ts");
  assert.match(route, /content-length/);
  assert.ok(route.indexOf("checkRate(db, \"design\"") < route.indexOf("openAiGate(") && route.indexOf("openAiGate(") < route.indexOf("loadModel("), "the allowance and the gate come before any work");
  assert.match(route, /maxOutputTokens: Math\.min\(MAX_OUTPUT_TOKENS, quota\.maxOutputTokens\)/);
  assert.match(route, /abortSignal: AbortSignal\.timeout\(/);
  assert.match(route, /finally \{\s*await gate\.release\(\)/, "the amount set aside is always given back");
  assert.match(route, /sanitizeDesign\(/, "what the model says is checked before it is saved");
  assert.match(route, /logChatUsage\(/, "the cost is counted");
  assert.doesNotMatch(route, /tools:|writeFile|stopWhen/, "no tools: the model can only answer with the brief");
  assert.ok(RATES.design.max > 0 && RATES.design.max <= 20);
  const ui = read("src/components/ImportCms.tsx");
  assert.match(ui, /Foreslå design med AI/);
  assert.match(ui, /Valgfritt/, "the AI step is optional");
}

console.log("design: all ok");
