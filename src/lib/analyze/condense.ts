/**
 * A measured spec can be large. The model gets a trimmed copy: the most useful facts are kept
 * (fonts, colours, section sizes, text, sizes and positions of the blocks) and the long tail is
 * dropped step by step until it fits. The full spec stays in the project for the comparison.
 */

export type Block = { k: string; t?: string; y: number; x: number; w: number; h: number; [key: string]: unknown };
export type Section = { i: number; tag: string; id: string; top: number; h: number; pt: number; pb: number; bg: string | null; bgi?: string; bt?: string | null; blocks: Block[]; boxes: Record<string, unknown>[]; more?: number; carousel?: number };
export type Spec = {
  url?: string;
  vw: number;
  /** Content width without the scrollbar. */
  cw?: number;
  vh: number;
  docH: number;
  title: string;
  lang: string;
  fonts: string[];
  vars: Record<string, string>;
  body: { bg: string | null; color: string | null; ff: string; fs: number; lh: string };
  header?: Record<string, unknown>;
  overlays?: Record<string, unknown>[];
  sections: Section[];
};

const DROP_KEYS_LIGHT = ["nw", "nh", "fl", "op", "of"];

function trimBlock(b: Block, textMax: number, light: boolean): Block {
  const copy: Block = { ...b };
  if (typeof copy.t === "string" && copy.t.length > textMax) copy.t = copy.t.slice(0, textMax) + "…";
  if (light) for (const key of DROP_KEYS_LIGHT) delete copy[key];
  return copy;
}

export function condenseSpec(spec: Spec, maxChars = 32_000): { json: string; steps: string[] } {
  const steps: string[] = [];
  let sections = spec.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => ({ ...b })), boxes: s.boxes.map((b) => ({ ...b })) }));
  const build = () => JSON.stringify({ ...spec, sections });
  let json = build();
  const stage = (label: string, fn: () => void) => {
    if (json.length <= maxChars) return;
    fn();
    json = build();
    steps.push(label);
  };

  stage("tekst kortet ned til 110 tegn", () => {
    sections = sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => trimBlock(b, 110, false)) }));
  });
  stage("ikoner (svg) og smådetaljer fjernet", () => {
    sections = sections.map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.k !== "svg").map((b) => trimBlock(b, 110, true)) }));
  });
  stage("tekst kortet ned til 70 tegn", () => {
    sections = sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => trimBlock(b, 70, true)) }));
  });
  stage("maks 45 blokker per seksjon", () => {
    sections = sections.map((s) => ({ ...s, more: (s.more ?? 0) + Math.max(0, s.blocks.length - 45), blocks: s.blocks.slice(0, 45) }));
  });
  stage("maks 28 blokker per seksjon", () => {
    sections = sections.map((s) => ({ ...s, more: (s.more ?? 0) + Math.max(0, s.blocks.length - 28), blocks: s.blocks.slice(0, 28), boxes: s.boxes.slice(0, 4) }));
  });
  stage("maks 16 blokker per seksjon", () => {
    sections = sections.map((s) => ({ ...s, more: (s.more ?? 0) + Math.max(0, s.blocks.length - 16), blocks: s.blocks.slice(0, 16), boxes: s.boxes.slice(0, 2) }));
  });
  return { json, steps };
}
