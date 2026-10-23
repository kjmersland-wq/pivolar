import assert from "node:assert/strict";
import { compareSpecs, fixMessage } from "../src/lib/analyze/compare.ts";
import type { Block, Section, Spec } from "../src/lib/analyze/condense.ts";

const h = (t: string, y: number, extra: Partial<Block> = {}): Block => ({ k: "h2", t, y, x: 20, w: 600, h: 60, fs: 48, fw: 700, lh: 60, ls: -0.5, c: "#eae4da", ...extra });
const p = (t: string, y: number, extra: Partial<Block> = {}): Block => ({ k: "p", t, y, x: 20, w: 600, h: 24, fs: 16, fw: 400, c: "#d1c9bc", ...extra });
const section = (i: number, top: number, hgt: number, blocks: Block[], extra: Partial<Section> = {}): Section => ({ i, tag: "section", id: "", top, h: hgt, pt: 96, pb: 96, bg: null, blocks, boxes: [], ...extra });
const spec = (sections: Section[], docH = 3000, cw = 1280): Spec => ({ vw: 1280, cw, vh: 800, docH, title: "T", lang: "nb", fonts: [], vars: {}, body: { bg: "#111111", color: "#eeeeee", ff: "Inter", fs: 16, lh: "24px" }, sections });

const ref = spec([
  section(0, 0, 800, [h("Welcome home", 120, { k: "h1" }), p("A short introduction to the place.", 200)]),
  section(1, 800, 600, [h("Our people", 96), p("They are very kind.", 170), { k: "btn", t: "Meet them", y: 260, x: 20, w: 160, h: 52, fs: 16, fw: 500, c: "#16100c", bg: "#e5ac4c", r: 6 } as Block], { boxes: [{ y: 300, x: 20, w: 1200, h: 240, n: 3, disp: "grid", gap: 24, cw: 384, ch: 240, r: 8 }] }),
  section(2, 1400, 500, [h("Contact", 96), p("Write to us.", 170)]),
]);

// --- identical specs: no deviations at all
{
  const c = compareSpecs(ref, JSON.parse(JSON.stringify(ref)));
  assert.equal(c.deviations.length, 0);
  assert.equal(c.matched, 3);
  assert.deepEqual(c.missingSections, []);
}

// --- small differences inside the tolerance are not reported
{
  const live = JSON.parse(JSON.stringify(ref)) as Spec;
  live.sections[1]!.h += 4;
  live.sections[1]!.blocks[0]!.y += 5;
  live.sections[1]!.blocks[0]!.fs = 48.3;
  live.docH += 8;
  assert.equal(compareSpecs(ref, live).deviations.length, 0, "rounding noise is ignored");
}

// --- real differences are found, with the numbers from both sides
{
  const live = JSON.parse(JSON.stringify(ref)) as Spec;
  live.sections[1]!.h = 640; // 40 too tall
  live.sections[1]!.blocks[0]!.y = 120; // heading 24 too low
  live.sections[1]!.blocks[0]!.fs = 40; // too small
  live.sections[1]!.blocks[1]!.c = "#ffffff"; // wrong colour
  live.sections[1]!.blocks[2]!.w = 200; // button too wide
  live.sections[1]!.boxes[0] = { ...live.sections[1]!.boxes[0]!, n: 2, ch: 280 };
  live.sections[2]!.blocks.splice(1, 1); // paragraph missing
  live.docH = 3100;
  const c = compareSpecs(ref, live);
  const text = c.deviations.map((d) => d.text).join("\n");
  assert.match(text, /seksjonshøyden skal være 600 px \(nå 640\)/);
  assert.match(text, /«Our people» skal ligge 96 px fra seksjonstoppen \(nå 120\)/);
  assert.match(text, /skriftstørrelse 48 px \(nå 40\)/);
  assert.match(text, /farge #d1c9bc \(nå #ffffff\)/);
  assert.match(text, /bredde 160 px \(nå 200\)/);
  assert.match(text, /3 kort i raden \(nå 2\)/);
  assert.match(text, /kortene er 240 px høye \(nå 280\)/);
  assert.match(text, /mangler: «Write to us\.»/);
  assert.match(text, /total sidehøyde skal være 3000 px \(nå 3100\)/);
  assert.ok(c.deviations[0]!.weight >= c.deviations.at(-1)!.weight, "ordered with the most visible first");
  const message = fixMessage(c, "https://ref.test/");
  assert.match(message, /^Jeg har målt forhåndsvisningen mot referansen \(https:\/\/ref\.test\/\)/);
  assert.match(message, /Rett KUN avvikene/);
  assert.match(message, /«Our people»:\n - /);
}

// --- sections are matched by heading, so an extra section in the preview shifts nothing
{
  const live = JSON.parse(JSON.stringify(ref)) as Spec;
  live.sections.splice(1, 0, section(9, 800, 300, [h("A brand new part", 96)]));
  live.sections.forEach((s, i) => { s.i = i; });
  const c = compareSpecs(ref, live);
  assert.equal(c.matched, 3);
  assert.deepEqual(c.missingSections, []);
}
// a section missing from the preview is named
{
  const live = JSON.parse(JSON.stringify(ref)) as Spec;
  live.sections.splice(2, 1);
  const c = compareSpecs(ref, live);
  assert.match(c.missingSections.join(), /«Contact» \(500 px høy\)/);
}

// --- a heading that reads differently is still paired by position and size
{
  const live = JSON.parse(JSON.stringify(ref)) as Spec;
  live.sections[1]!.blocks[0]!.t = "Meet our people";
  live.sections[1]!.top = 810;
  const c = compareSpecs(ref, live);
  assert.equal(c.matched, 3, "paired by where it is and how tall it is");
  assert.match(c.deviations.map((d) => d.text).join("\n"), /mangler: «Our people»/);
}

// --- colours with alpha cannot be compared on their own
{
  const a = JSON.parse(JSON.stringify(ref)) as Spec;
  const b = JSON.parse(JSON.stringify(ref)) as Spec;
  a.sections[1]!.blocks[1]!.c = "#ffffff @0.85";
  b.sections[1]!.blocks[1]!.c = "#eae4da";
  assert.equal(compareSpecs(a, b).deviations.length, 0);
}

// --- carousels: only the size is compared, and the message says so
{
  const a = JSON.parse(JSON.stringify(ref)) as Spec;
  const b = JSON.parse(JSON.stringify(ref)) as Spec;
  a.sections[0]!.carousel = 3;
  b.sections[0]!.blocks = [h("Another slide", 200, { k: "h1" })];
  b.sections[0]!.h = 1000;
  const c = compareSpecs(a, b);
  const text = c.deviations.map((d) => d.text).join("\n");
  assert.doesNotMatch(text, /Welcome home|mangler/);
  assert.match(text, /seksjonshøyden skal være 800 px \(nå 1000\)/);
  assert.equal(c.carousels.length, 1);
  assert.match(fixMessage(c, undefined), /karusell med flere slides/);
}

// --- the scrollbar: the reference has none, a real preview may have 15 px
{
  const live = JSON.parse(JSON.stringify(ref)) as Spec;
  live.cw = 1265;
  live.sections[1]!.blocks[2]!.w = 150; // 10 px narrower: within what a scrollbar explains
  live.sections[1]!.boxes[0] = { ...live.sections[1]!.boxes[0]!, cw: 379 };
  assert.equal(compareSpecs(ref, live).deviations.filter((d) => /bredde|brede/.test(d.text)).length, 0);
}

// --- the list is capped and says how many were left out
{
  const many = spec([section(0, 0, 4000, Array.from({ length: 80 }, (_, i) => p(`Linje nummer ${i}`, i * 40)))]);
  const live = JSON.parse(JSON.stringify(many)) as Spec;
  live.sections[0]!.blocks.forEach((b) => { b.y += 30; });
  const c = compareSpecs(many, live, 40);
  assert.equal(c.deviations.length, 40);
  assert.equal(c.more, 40);
  assert.match(fixMessage(c, undefined), /40 mindre avvik er utelatt/);
}

console.log("compare: all ok");
