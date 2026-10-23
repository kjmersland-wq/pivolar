import type { Block, Section, Spec } from "./condense.ts";

/**
 * Compares what the preview measures with what the reference measured, and says where they differ.
 * Sections are matched by their first heading, blocks by their text, and everything is judged against
 * a tolerance, so rounding and the scrollbar do not show up as faults.
 */

export type Deviation = {
  section: string;
  /** Larger means more visible. Used to order and to cap the list. */
  weight: number;
  text: string;
};

export type Comparison = {
  docRef: number;
  docLive: number;
  matched: number;
  missingSections: string[];
  /** Sections with stacked slides: their content depends on the active slide, so only the size is compared. */
  carousels: string[];
  deviations: Deviation[];
  /** True when the list was cut. */
  more: number;
};

const TOL = { height: 6, pad: 8, y: 8, size: 0.6, weight: 100, spacing: 1.5, color: 28, box: 6 };

const norm = (value: string | undefined) => (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const short = (value: string | undefined, n = 38) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

function sectionKey(section: Section): string {
  const heading = section.blocks.find((b) => /^h[1-4]$/.test(b.k) && b.t);
  const first = heading ?? section.blocks.find((b) => b.t && b.t.length > 6);
  return norm(first?.t).slice(0, 28);
}

function sectionName(section: Section): string {
  const heading = section.blocks.find((b) => /^h[1-4]$/.test(b.k) && b.t) ?? section.blocks.find((b) => b.t && b.t.length > 3);
  return heading?.t ? `«${short(heading.t, 30)}»` : section.id ? `#${section.id}` : `${section.tag} ${section.i + 1}`;
}

/** Solid colours only: a colour with alpha depends on what is behind it, so it cannot be compared on its own. */
function parseHex(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const colorDistance = (a: [number, number, number], b: [number, number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

function pairSections(ref: Section[], live: Section[]): { ref: Section; live: Section | null }[] {
  const used = new Set<number>();
  const pairs = ref.map((r) => ({ ref: r, live: null as Section | null }));
  pairs.forEach((p) => {
    const key = sectionKey(p.ref);
    if (!key) return;
    const at = live.findIndex((l, i) => !used.has(i) && sectionKey(l) === key);
    if (at >= 0) {
      used.add(at);
      p.live = live[at]!;
    }
  });
  // What is left is paired by position and size: same place in the order, similar height.
  for (const p of pairs) {
    if (p.live) continue;
    let best = -1;
    let bestScore = Infinity;
    live.forEach((l, i) => {
      if (used.has(i) || l.h < p.ref.h * 0.5 || l.h > p.ref.h * 2) return;
      const score = Math.abs(l.top - p.ref.top) + Math.abs(l.h - p.ref.h);
      if (score < bestScore && Math.abs(l.top - p.ref.top) < 450) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      p.live = live[best]!;
    }
  }
  return pairs;
}

function blockKey(b: Block): string {
  if (b.k === "img") return `img:${String(b.src ?? "").split("/").pop()?.split("?")[0]?.slice(0, 28) ?? ""}`;
  if (b.k === "svg" || b.k === "embed") return "";
  return `t:${norm(b.t).slice(0, 36)}`;
}

function compareBlocks(name: string, ref: Section, live: Section, tolX: number, out: Deviation[]) {
  const pool = [...live.blocks];
  let missing = 0;
  const said = new Set<string>();
  for (const rb of ref.blocks) {
    const key = blockKey(rb);
    if (!key || key === "t:") continue;
    // The same text can occur more than once (menus, repeated cards): take the one nearest in height.
    let at = -1;
    let nearest = Infinity;
    pool.forEach((lb, i) => {
      if (blockKey(lb) !== key) return;
      const d = Math.abs(lb.y - rb.y);
      if (d < nearest) {
        nearest = d;
        at = i;
      }
    });
    if (at < 0) {
      // A text that repeats (a scrolling ticker, repeated cards) is reported once.
      if (rb.t && rb.t.length > 3 && missing < 4 && !said.has(key)) {
        said.add(key);
        missing++;
        out.push({ section: name, weight: 40, text: `mangler: «${short(rb.t)}»` });
      }
      continue;
    }
    const lb = pool.splice(at, 1)[0]!;
    const label = rb.k === "img" ? "bildet" : `«${short(rb.t, 30)}»`;

    if (Math.abs(rb.y - lb.y) >= TOL.y) out.push({ section: name, weight: Math.abs(rb.y - lb.y), text: `${label} skal ligge ${rb.y} px fra seksjonstoppen (nå ${lb.y})` });
    const rfs = rb.fs as number | undefined, lfs = lb.fs as number | undefined;
    if (rfs && lfs && Math.abs(rfs - lfs) >= TOL.size) out.push({ section: name, weight: 12 * Math.abs(rfs - lfs), text: `${label}: skriftstørrelse ${rfs} px (nå ${lfs})` });
    const rfw = rb.fw as number | undefined, lfw = lb.fw as number | undefined;
    if (rfw && lfw && Math.abs(rfw - lfw) >= TOL.weight) out.push({ section: name, weight: 14, text: `${label}: skriftvekt ${rfw} (nå ${lfw})` });
    const rlh = rb.lh as number | undefined, llh = lb.lh as number | undefined;
    if (rlh && llh && Math.abs(rlh - llh) >= 3 && rfs && Math.abs((rfs ?? 0) - (lfs ?? 0)) < TOL.size) out.push({ section: name, weight: Math.abs(rlh - llh), text: `${label}: linjehøyde ${rlh} px (nå ${llh})` });
    const rls = (rb.ls as number | undefined) ?? 0, lls = (lb.ls as number | undefined) ?? 0;
    if (rfs && Math.abs(rls - lls) >= TOL.spacing) out.push({ section: name, weight: 8, text: `${label}: bokstavavstand ${rls} px (nå ${lls})` });
    const rc = parseHex(rb.c), lc = parseHex(lb.c);
    if (rc && lc && !rb.grad && colorDistance(rc, lc) >= TOL.color) out.push({ section: name, weight: 22, text: `${label}: farge ${String(rb.c)} (nå ${String(lb.c)})` });
    const boxy = rb.k === "img" || Boolean(rb.bg) || Boolean(rb.bd);
    if (rb.w && lb.w && Math.abs(rb.w - lb.w) >= Math.max(TOL.box, tolX) + 4 && boxy && Math.abs(rb.w - lb.w) / rb.w < 0.5) {
      out.push({ section: name, weight: Math.abs(rb.w - lb.w) / 2, text: `${label}: bredde ${rb.w} px (nå ${lb.w})` });
    }
    if (rb.h && lb.h && Math.abs(rb.h - lb.h) >= 8 && boxy) {
      out.push({ section: name, weight: Math.abs(rb.h - lb.h) / 2, text: `${label}: høyde ${rb.h} px (nå ${lb.h})` });
    }
  }
}

function compareBoxes(name: string, ref: Section, live: Section, tolX: number, out: Deviation[]) {
  ref.boxes.forEach((rb, i) => {
    const lb = live.boxes[i];
    if (!lb) return;
    const r = rb as Record<string, number | string | undefined>, l = lb as Record<string, number | string | undefined>;
    const label = `kortrad ${i + 1}`;
    if (r.n !== l.n) out.push({ section: name, weight: 30, text: `${label}: ${String(r.n)} kort i raden (nå ${String(l.n)})` });
    if (typeof r.ch === "number" && typeof l.ch === "number" && Math.abs(r.ch - l.ch) >= 8) out.push({ section: name, weight: Math.abs(r.ch - l.ch) / 2, text: `${label}: kortene er ${r.ch} px høye (nå ${l.ch})` });
    if (typeof r.cw === "number" && typeof l.cw === "number" && Math.abs(r.cw - l.cw) >= Math.max(10, tolX / Math.max(1, Number(r.n)) + 6)) out.push({ section: name, weight: Math.abs(r.cw - l.cw) / 2, text: `${label}: kortene er ${r.cw} px brede (nå ${l.cw})` });
    if (typeof r.gap === "number" && typeof l.gap === "number" && Math.abs(r.gap - l.gap) >= 4) out.push({ section: name, weight: 10, text: `${label}: mellomrom ${r.gap} px (nå ${l.gap})` });
    if (r.r !== undefined && l.r !== undefined && Math.abs(Number(r.r) - Number(l.r)) >= 3) out.push({ section: name, weight: 9, text: `${label}: hjørneradius ${String(r.r)} px (nå ${String(l.r)})` });
  });
}

export function compareSpecs(ref: Spec, live: Spec, maxItems = 40): Comparison {
  // The reference was measured without a scrollbar; a real preview may have one.
  const tolX = Math.abs((ref.cw ?? ref.vw) - (live.cw ?? live.vw));
  const deviations: Deviation[] = [];
  const missingSections: string[] = [];
  const carousels: string[] = [];
  const pairs = pairSections(ref.sections, live.sections);
  let matched = 0;

  for (const { ref: r, live: l } of pairs) {
    const name = sectionName(r);
    if (!l) {
      if (r.h > 40) missingSections.push(`${name} (${r.h} px høy)`);
      continue;
    }
    matched++;
    if (Math.abs(r.h - l.h) >= TOL.height) deviations.push({ section: name, weight: Math.abs(r.h - l.h), text: `seksjonshøyden skal være ${r.h} px (nå ${l.h})` });
    if (r.pt && l.pt && Math.abs(r.pt - l.pt) >= TOL.pad) deviations.push({ section: name, weight: Math.abs(r.pt - l.pt), text: `topp-padding ${r.pt} px (nå ${l.pt})` });
    if (r.pb && l.pb && Math.abs(r.pb - l.pb) >= TOL.pad) deviations.push({ section: name, weight: Math.abs(r.pb - l.pb), text: `bunn-padding ${r.pb} px (nå ${l.pb})` });
    if (r.carousel || l.carousel) {
      carousels.push(name);
    } else {
      compareBlocks(name, r, l, tolX, deviations);
      compareBoxes(name, r, l, tolX, deviations);
    }
  }
  if (Math.abs(ref.docH - live.docH) >= 12) deviations.push({ section: "Hele siden", weight: Math.abs(ref.docH - live.docH) / 2, text: `total sidehøyde skal være ${ref.docH} px (nå ${live.docH})` });

  deviations.sort((a, b) => b.weight - a.weight);
  const kept = deviations.slice(0, maxItems);
  return { docRef: ref.docH, docLive: live.docH, matched, missingSections, carousels, deviations: kept, more: Math.max(0, deviations.length - kept.length) };
}

/** The message that asks Pivolar to fix the differences. Written like a precise brief. */
export function fixMessage(comparison: Comparison, referenceUrl: string | undefined): string {
  const bySection = new Map<string, Deviation[]>();
  for (const d of comparison.deviations) bySection.set(d.section, [...(bySection.get(d.section) ?? []), d]);
  const lines: string[] = [
    `Jeg har målt forhåndsvisningen mot referansen${referenceUrl ? ` (${referenceUrl})` : ""}, begge på 1280 px bredde. Rett KUN avvikene under med editFile (ikke skriv om hele filer), og la alt annet stå. Tallene først er referansen, «nå» er det jeg målte hos deg. Bruk faste px på 1024 px og opp. Avstander "fra seksjonstoppen" er fra toppen av seksjonen til toppen av elementet. Endrer du topp-avstand i en seksjon, juster bunn-padding tilsvarende så seksjonshøyden blir riktig.`,
    `Total sidehøyde: referansen ${comparison.docRef} px, nå ${comparison.docLive} px.`,
  ];
  if (comparison.missingSections.length) lines.push(`Seksjoner som mangler: ${comparison.missingSections.join("; ")}.`);
  if (comparison.carousels.length) lines.push(`${comparison.carousels.join("; ")} er en karusell med flere slides. Innholdet er ikke sammenlignet siden det avhenger av aktiv slide, bare størrelsen. Sjekk hver slide mot referansen for hånd.`);
  for (const [section, items] of bySection) {
    if (section === "Hele siden") continue;
    lines.push("", `${section}:`, ...items.map((d) => ` - ${d.text}`));
  }
  if (comparison.more > 0) lines.push("", `(${comparison.more} mindre avvik er utelatt. Ta de største først.)`);
  return lines.join("\n");
}
