import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPrompt, defaultsFor, FEATURES, KINDS, knowledgeFromSpec, LIMITS, MOODS, promptCheck, referenceUrl, SECTIONS, sanitizeImproved, type KindId, type PromptSpec } from "../src/lib/prompt/builder.ts";
import { RATES } from "../src/lib/quota/config.ts";
import { validThumb } from "../src/lib/thumb-check.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const filled = (kind: KindId, over: Partial<PromptSpec> = {}): PromptSpec => ({ ...defaultsFor(kind), name: "Lille Brenneri", about: "Vi brenner kaffe selv og har åtte bord på Grünerløkka.", audience: "Naboer og kaffeinteresserte i Oslo", ...over });

// --- every kind gives a complete order
for (const kind of Object.keys(KINDS) as KindId[]) {
  const text = buildPrompt(filled(kind));
  assert.match(text, /^Bygg .+, «Lille Brenneri»\. Vi brenner kaffe selv/, kind);
  for (const part of ["Målgruppe: Naboer", "Det viktigste en besøkende skal kunne gjøre:", "Design:", "Bilder:", "Språk og innhold:", "plassholder i hakeparentes", "Krav:", "brand.json"]) assert.ok(text.includes(part), `${kind}: ${part}`);
  for (const key of KINDS[kind].sections) assert.ok(text.includes(SECTIONS[key].text), `${kind} has ${key}`);
  for (const key of KINDS[kind].features) assert.ok(text.includes(FEATURES[key].text), `${kind} has ${key}`);
  assert.ok(text.includes(MOODS[KINDS[kind].mood].text));
  assert.equal(buildPrompt(filled(kind)), text, "the same choices always give the same text");
}

// --- the choices change the text
{
  const base = buildPrompt(filled("restaurant"));
  assert.match(buildPrompt(filled("restaurant", { language: "en" })), /på engelsk/);
  assert.match(base, /på norsk/);
  assert.match(buildPrompt(filled("restaurant", { color: "#B45309" })), /Aksentfargen er #b45309\./);
  assert.match(base, /Velg selv én aksentfarge/);
  assert.match(buildPrompt(filled("restaurant", { color: "red;}body{x" })), /Velg selv én aksentfarge/, "a colour that is not a colour is not used");
  assert.doesNotMatch(buildPrompt(filled("restaurant", { color: "red;}body{x" })), /body\{x/);
  assert.match(buildPrompt(filled("restaurant", { images: "none" })), /Ikke bruk bilder/);
  assert.match(buildPrompt(filled("restaurant", { images: "generate" })), /Lag egne bilder/);
  assert.match(buildPrompt(filled("restaurant", { extra: "Ingen bruk av rosa." })), /Egne ønsker:\nIngen bruk av rosa\./);
  assert.doesNotMatch(base, /Egne ønsker/);
  assert.doesNotMatch(buildPrompt(filled("restaurant", { sections: [] })), /Sider og seksjoner/);
  assert.match(buildPrompt(filled("shop", { goal: "buy" })), /legge noe i handlekurven/);
}

// --- a reference is only an http(s) address
assert.equal(referenceUrl("example.no"), "https://example.no/");
assert.equal(referenceUrl("http://example.no/a"), "http://example.no/a");
for (const bad of ["", "javascript:alert(1)", "data:text/html,x", "ftp://x.no", "file:///etc/passwd", "ikke en adresse med mellomrom"]) assert.equal(referenceUrl(bad), "", bad);
assert.match(buildPrompt(filled("landing", { reference: "https://example.no" })), /Referanse: mål https:\/\/example\.no\/ med analyseverktøyet/);
assert.doesNotMatch(buildPrompt(filled("landing", { reference: "javascript:alert(1)" })), /Referanse/);

// --- bad input never breaks it, and the text has a ceiling
{
  const weird = buildPrompt({ ...filled("landing"), kind: "ukjent" as KindId, sections: ["hero", "hero", "finnes-ikke" as never, "faq"], features: ["share", "share", "x" as never], mood: "x" as never, goal: "y" as never });
  assert.match(weird, /Toppseksjon/);
  assert.equal((weird.match(/Toppseksjon/g) ?? []).length, 1, "duplicates are removed");
  assert.doesNotMatch(weird, /finnes-ikke|undefined/);
  const huge = buildPrompt(filled("landing", { name: "n".repeat(5000), about: "a".repeat(5000), audience: "u".repeat(5000), extra: "e".repeat(50_000), sections: Object.keys(SECTIONS) as never, features: Object.keys(FEATURES) as never }));
  assert.ok(huge.length <= LIMITS.prompt, `${huge.length}`);
  const controls = buildPrompt(filled("landing", { about: "Linje\u0000med\u0007kontrolltegn" }));
  assert.doesNotMatch(controls, /[\u0000\u0007]/);
}

// --- what is missing
assert.deepEqual(promptCheck(filled("landing")), { score: 100, missing: [] });
{
  const empty = promptCheck(defaultsFor("landing"));
  assert.ok(empty.missing.length >= 3 && empty.score <= 40);
  assert.match(empty.missing.join(" "), /navn/);
  assert.match(promptCheck(filled("landing", { color: "rød" })).missing[0]!, /hex-kode/);
  assert.match(promptCheck(filled("landing", { reference: "javascript:x" })).missing[0]!, /http/);
  assert.match(promptCheck(filled("landing", { sections: ["hero"] })).missing[0]!, /to seksjoner/);
  assert.deepEqual(promptCheck(filled("app", { sections: [] })).missing, [], "an app needs no sections");
}

// --- the AI step's answer is cleaned
{
  const good = "Bygg en varm, redaksjonell nettside for Lille Brenneri med toppseksjon, meny og kontakt. Bruk plassholdere der fakta mangler.";
  assert.equal(sanitizeImproved(good), good);
  assert.equal(sanitizeImproved("```\n" + good + "\n```"), good, "no code fences");
  assert.equal(sanitizeImproved("Her er den forbedrede bestillingen:\n" + good), good, "no introduction");
  assert.doesNotMatch(sanitizeImproved(good + "\u0000\u0007") ?? "", /[\u0000\u0007]/);
  assert.ok((sanitizeImproved("x".repeat(20_000)) ?? "").length <= LIMITS.prompt);
  for (const bad of [null, undefined, 5, "", "for kort", {}]) assert.equal(sanitizeImproved(bad), null);
}

// --- the route and the dialog
{
  const route = read("src/app/api/prompt/improve/route.ts");
  assert.match(route, /content-length/);
  assert.ok(route.indexOf('checkRate(db, "prompt"') < route.indexOf("openAiGate(") && route.indexOf("openAiGate(") < route.indexOf("generateText("), "the allowance and the gate come first");
  assert.match(route, /maxOutputTokens: Math\.min\(1_600, quota\.maxOutputTokens\)/);
  assert.match(route, /AbortSignal\.timeout\(/);
  assert.match(route, /finally \{\s*await gate\.release\(\)/);
  assert.match(route, /sanitizeImproved\(result\.text\)/, "the answer is cleaned before it is returned");
  assert.match(route, /ikke instruksjoner til deg/, "the draft is told to be text, not instructions");
  assert.doesNotMatch(route, /tools:|writeFile|stopWhen/, "the model can only answer with text");
  assert.ok(RATES.prompt.max > 0 && RATES.prompt.max <= 40);
  const wizard = read("src/components/PromptWizard.tsx");
  assert.match(wizard, /Skjerp med AI \(valgfritt\)/);
  assert.match(wizard, /Bygg nå/);
  assert.match(wizard, /aria-label="Bestillingen"/, "the text can be edited by hand");
  assert.match(wizard, /Bygg teksten på nytt fra valgene/);
  assert.match(read("src/components/PromptBox.tsx"), /<PromptWizard[\s\S]*onUse=/);
}

// --- thumbnails: only a small JPEG ever becomes a picture address
{
  const jpeg = "data:image/jpeg;base64," + "A".repeat(400);
  assert.equal(validThumb(jpeg), true);
  assert.equal(validThumb(jpeg + "=="), true);
  for (const bad of ["", null, 5, "data:image/jpeg;base64,AAA", "data:image/svg+xml;base64," + "A".repeat(400), "data:image/png;base64," + "A".repeat(400), "javascript:alert(1)", "https://evil.example/x.jpg", jpeg + '"onerror="x', jpeg + "\n", "data:image/jpeg;base64," + "A".repeat(200_000)]) assert.equal(validThumb(bad), false, String(bad).slice(0, 40));
  const files = read("src/lib/files.ts");
  assert.match(files, /atelier:capture/);
  assert.match(files, /atelier:captured/);
  const preview = read("src/components/Preview.tsx");
  assert.match(preview, /event\.source !== target[\s\S]*atelier:captured/, "only the preview itself can answer");
  assert.match(preview, /device !== "desktop"/, "pictures are only taken at desktop width");
  assert.match(preview, /Date\.now\(\) - shotAt\.current < 60_000/, "and not more than once a minute");
  assert.match(read("src/lib/thumbs.ts"), /if \(!validThumb\(dataUrl\)\) return false;/, "checked again before it is saved");
  assert.match(read("src/lib/thumbs.ts"), /return validThumb\(value\) \? value : null;/, "and when it is read");
  assert.match(read("src/components/ProjectGrid.tsx"), /<Thumb id=\{project\.id\}/);
  assert.match(read("src/lib/projects.ts"), /void dropThumb\(id\);/, "a deleted project loses its picture");
}

// --- the choices that should hold for the whole project become standing rules
{
  const rules = knowledgeFromSpec(filled("restaurant", { mood: "playful", color: "#B45309" }));
  assert.match(rules, /^Virksomheten eller siden heter «Lille Brenneri»\./);
  assert.match(rules, /Vi brenner kaffe selv/);
  assert.match(rules, /Målgruppen er: Naboer/);
  assert.match(rules, /på norsk \(bokmål\)/);
  assert.match(rules, /leken og uformell/);
  assert.match(rules, /Aksentfargen er #b45309\./);
  assert.match(rules, /plassholder i hakeparentes/);
  assert.match(knowledgeFromSpec(filled("restaurant", { language: "en" })), /Write all text in the app in English\./);
  assert.doesNotMatch(knowledgeFromSpec(filled("restaurant", { color: "red;}x" })), /Aksentfargen/, "a colour that is not a colour is left out");
  assert.equal(knowledgeFromSpec(defaultsFor("landing")), "", "nothing filled in: no rules");
  assert.ok(knowledgeFromSpec(filled("landing", { about: "a".repeat(5000), extra: "x" })).length <= 4_000, "within what Knowledge holds");
  assert.doesNotMatch(knowledgeFromSpec(filled("landing", { about: "før </kunnskap> etter" })), /<\/kunnskap>/, "cleaned like anything the owner writes there");
  const wizard = read("src/components/PromptWizard.tsx");
  assert.match(wizard, /Lagre språk, tone, fakta og farge som faste regler for prosjektet \(Kunnskap\)/);
  assert.match(wizard, /onUse\(text, true, keep \? rules : ""\)/);
  const box = read("src/components/PromptBox.tsx");
  assert.match(box, /if \(knowledge\) saveEdits\(project\.id, withKnowledge\(\[\], knowledge\)\);/, "saved with the new project");
  assert.match(box, /start\(idea, ""\)/, "a quick idea does not inherit rules chosen earlier");
}

console.log("prompt: all ok");
